import type { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export type Status = 'pending' | 'approved' | 'rejected' | 'expired' | 'executing' | 'done' | 'failed';
export type Proposal = {
  id: string;
  kind: string;
  target: string;
  body: string;
  final_body: string | null;
  status: Status;
  confidence: number;
  source_ref: string;
  auto_approved: number;
  reason: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
};

export class ConflictError extends Error {}

const DAY = 24 * 3600 * 1000;

export function createProposal(
  db: Database,
  p: { kind: string; target: string; body: string; confidence: number; sourceRef: string; ttlMs?: number },
  now = Date.now(),
): Proposal {
  const id = randomUUID().slice(0, 8);
  db.query(
    `INSERT INTO proposals (id, kind, target, body, status, confidence, source_ref, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
  ).run(id, p.kind, p.target, p.body, p.confidence, p.sourceRef, now, now, now + (p.ttlMs ?? DAY));
  logEvent(db, id, 'created', null, now);
  return getProposal(db, id)!;
}

export const getProposal = (db: Database, id: string) =>
  db.query('SELECT * FROM proposals WHERE id = ?').get(id) as Proposal | null;

export const listProposals = (db: Database, status?: Status) =>
  (status
    ? db.query('SELECT * FROM proposals WHERE status = ? ORDER BY created_at').all(status)
    : db.query('SELECT * FROM proposals ORDER BY created_at').all()) as Proposal[];

export const logEvent = (db: Database, proposalId: string, type: string, detail: string | null, now = Date.now()) =>
  db.query('INSERT INTO events (proposal_id, type, detail, at) VALUES (?, ?, ?, ?)').run(proposalId, type, detail, now);

// 状态迁移只走这一个函数：UPDATE … WHERE status IN (允许的起点)，靠影响行数判断成没成。
// 两个进程同时批准同一条，只有一个能把 pending 改掉，另一个拿到 ConflictError。
export function transition(
  db: Database,
  id: string,
  from: Status[],
  to: Status,
  fields: { final_body?: string; reason?: string | null; error?: string | null; auto_approved?: number } = {},
  now = Date.now(),
): void {
  const sets = ['status = ?', 'updated_at = ?'];
  const args: (string | number | null)[] = [to, now];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    args.push(v as string | number | null);
  }
  const placeholders = from.map(() => '?').join(', ');
  const res = db.query(`UPDATE proposals SET ${sets.join(', ')} WHERE id = ? AND status IN (${placeholders})`).run(...args, id, ...from);
  if (res.changes !== 1) {
    const current = getProposal(db, id);
    throw new ConflictError(current ? `提案 ${id} 当前是 ${current.status}，不能改成 ${to}` : `没有提案 ${id}`);
  }
  logEvent(db, id, to, fields.reason ?? fields.error ?? null, now);
}

export const idempotencyKey = (proposalId: string, body: string) =>
  createHash('sha256').update(`${proposalId}\n${body}`).digest('hex').slice(0, 32);

// 批准：改状态 + 写发件箱放在同一个事务里（transactional outbox）。要么都成，要么都没发生。
export function approve(db: Database, id: string, opts: { editedBody?: string; auto?: boolean } = {}, now = Date.now()): void {
  db.transaction(() => {
    const p = getProposal(db, id);
    if (!p) throw new ConflictError(`没有提案 ${id}`);
    const body = opts.editedBody ?? p.body;
    // failed 的可以再批准一次：同样的正文得到同样的幂等键，对方服务会去重
    transition(db, id, ['pending', 'failed'], 'approved', { final_body: body, auto_approved: opts.auto ? 1 : 0, error: null }, now);
    if (p.kind !== 'reply') return; // 非对外发送的提案（如 P4 的档案修改）由各自的执行器处理
    const key = idempotencyKey(id, body);
    const existing = db.query('SELECT status FROM outbox WHERE idempotency_key = ?').get(key) as { status: string } | null;
    if (existing?.status === 'sent') {
      transition(db, id, ['approved'], 'done', { reason: '这段内容之前已经发出过' }, now);
      return;
    }
    db.query(
      `INSERT INTO outbox (idempotency_key, proposal_id, target, body, status, created_at) VALUES (?, ?, ?, ?, 'queued', ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET status = 'queued', last_error = NULL WHERE outbox.status = 'failed'`,
    ).run(key, id, p.target, body, now);
  })();
}

export const reject = (db: Database, id: string, reason: string, now = Date.now()) =>
  transition(db, id, ['pending', 'failed'], 'rejected', { reason }, now);

// 过期：待审批太久的草稿多半已经不合时宜，宁可作废也不要晚发。
export function expireStale(db: Database, now = Date.now()): number {
  const stale = db.query("SELECT id FROM proposals WHERE status = 'pending' AND expires_at < ?").all(now) as { id: string }[];
  for (const { id } of stale) transition(db, id, ['pending'], 'expired', { reason: '超过有效期未处理' }, now);
  return stale.length;
}

// 启动恢复：上次进程在"发送中"退出，不知道到底发没发出去。不自动重发，退回待审批让人决定；
// 再批准时用的是同一个幂等键，对方若已收到会去重，不会发两遍。
export function recoverInterrupted(db: Database, now = Date.now()): number {
  const stuck = db.query("SELECT id FROM proposals WHERE status = 'executing'").all() as { id: string }[];
  db.transaction(() => {
    for (const { id } of stuck) {
      transition(db, id, ['executing'], 'pending', { error: '上次发送时进程中断，不确定是否已发出；可直接重新批准，不会重复发送' }, now);
      db.query("UPDATE outbox SET status = 'failed', last_error = '进程中断' WHERE proposal_id = ? AND status = 'queued'").run(id);
    }
  })();
  return stuck.length;
}
