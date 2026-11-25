import type { Database } from 'bun:sqlite';
import { transition } from './proposals';

// 外部发送接口的抽象。真实实现可以是邮件、IM、工单系统；要求它支持幂等键（或自己按幂等键去重）。
export interface Sender {
  send(msg: { idempotencyKey: string; target: string; body: string }): Promise<{ remoteId: string }>;
}

type Row = { idempotency_key: string; proposal_id: string; target: string; body: string; attempts: number };

// 把发件箱里排队的消息发出去。每条：approved → executing → done；失败重试，超过次数标 failed 交还给人。
export async function drainOutbox(db: Database, sender: Sender, opts: { maxAttempts?: number; now?: () => number } = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const now = opts.now ?? Date.now;
  const rows = db.query("SELECT * FROM outbox WHERE status = 'queued' ORDER BY created_at").all() as Row[];
  const report = { sent: 0, failed: 0 };
  for (const row of rows) {
    transition(db, row.proposal_id, ['approved'], 'executing', {}, now());
    for (let attempt = row.attempts + 1; ; attempt++) {
      try {
        const { remoteId } = await sender.send({ idempotencyKey: row.idempotency_key, target: row.target, body: row.body });
        db.transaction(() => {
          db.query("UPDATE outbox SET status = 'sent', attempts = ?, remote_id = ?, sent_at = ? WHERE idempotency_key = ?").run(
            attempt,
            remoteId,
            now(),
            row.idempotency_key,
          );
          transition(db, row.proposal_id, ['executing'], 'done', {}, now());
        })();
        report.sent++;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.query('UPDATE outbox SET attempts = ?, last_error = ? WHERE idempotency_key = ?').run(attempt, message, row.idempotency_key);
        if (attempt >= maxAttempts) {
          db.transaction(() => {
            db.query("UPDATE outbox SET status = 'failed' WHERE idempotency_key = ?").run(row.idempotency_key);
            transition(db, row.proposal_id, ['executing'], 'failed', { error: `发送失败 ${attempt} 次：${message}` }, now());
          })();
          report.failed++;
          break;
        }
        await Bun.sleep(200 * 2 ** (attempt - 1)); // 指数退避
      }
    }
  }
  return report;
}
