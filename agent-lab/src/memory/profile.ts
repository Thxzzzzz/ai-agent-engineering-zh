import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import type { Model } from '../model';
import { approve, createProposal, getProposal, transition } from '../proposals';
import { completeStructured } from '../structured';
import { validMemories } from './store';

export const Profile = z.strictObject({
  role: z.string().nullable().describe('职责与角色，一句话'),
  responsibilities: z.array(z.string()),
  communication: z.string().nullable().describe('沟通习惯，以及我和他沟通时该注意什么'),
  working_notes: z.array(z.string()).describe('合作中值得记住的具体事'),
});
export type Profile = z.infer<typeof Profile>;

type Row = { subject: string; profile: string; manual_notes: string; updated_at: number };

export function getProfile(db: Database, subject: string): { profile: Profile; manualNotes: string } | null {
  const row = db.query('SELECT * FROM profiles WHERE subject = ?').get(subject) as Row | null;
  return row ? { profile: JSON.parse(row.profile) as Profile, manualNotes: row.manual_notes } : null;
}

// 定期综合：把一个人仍然有效的记忆条目压成一份档案。只改 profile 列，人手写的 manual_notes 原样保留。
export async function synthesizeProfile(db: Database, model: Model, subject: string, now = Date.now()): Promise<Profile> {
  const facts = validMemories(db, subject);
  const existing = getProfile(db, subject);
  const { value } = await completeStructured(model, {
    schema: Profile,
    system: '根据记忆条目为这个人写一份工作档案。只写条目能支持的内容，没有依据的字段留空（null 或空数组）。手写备注的优先级最高，与条目冲突时以备注为准。',
    user: `对象：${subject}\n手写备注：${existing?.manualNotes || '（无）'}\n记忆条目：\n${facts.map((f) => `- ${f.content}`).join('\n')}`,
  });
  db.query(
    `INSERT INTO profiles (subject, profile, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(subject) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at`,
  ).run(subject, JSON.stringify(value), now);
  return value;
}

const Reflection = z.strictObject({
  changes: z.array(
    z.strictObject({
      field: z.enum(['communication', 'working_notes']),
      new_value: z.string().describe('communication 写改后的整句；working_notes 写要新增的一条'),
      evidence: z.string().describe('依据哪几次拒绝或改写'),
    }),
  ),
});

// 反思：从"我拒绝了哪些草稿、怎么改的"里找稳定规律，生成待审批的档案修改提案（复用 P3 的提案表）。
// 大多数时候不该改：一次偶然的改写不是规律。
export async function reflect(db: Database, model: Model, subject: string): Promise<string[]> {
  const signals = db
    .query(
      `SELECT body, final_body, status, reason FROM proposals
       WHERE kind = 'reply' AND target = ? AND (status = 'rejected' OR (status = 'done' AND final_body != body))
       ORDER BY updated_at DESC LIMIT 30`,
    )
    .all(subject) as { body: string; final_body: string | null; status: string; reason: string | null }[];
  if (signals.length < 3) return [];
  const current = getProfile(db, subject);
  const { value } = await completeStructured(model, {
    schema: Reflection,
    system: '你在帮用户改进与某人沟通的方式。只有能概括成稳定习惯的规律才提出修改，偶然一次的不算；没有就返回空数组。',
    user: `对象：${subject}\n当前档案：${JSON.stringify(current?.profile ?? null)}\n\n最近的信号：\n${signals
      .map((s) => (s.status === 'rejected' ? `- 拒绝了草稿「${s.body}」，理由：${s.reason ?? '无'}` : `- 草稿「${s.body}」被改成「${s.final_body}」`))
      .join('\n')}`,
  });
  return value.changes.map((c) => {
    const before = c.field === 'communication' ? (current?.profile.communication ?? null) : null;
    const body = JSON.stringify({ field: c.field, before, after: c.new_value, evidence: c.evidence });
    return createProposal(db, { kind: 'profile_update', target: subject, body, confidence: 0.5, sourceRef: 'reflect' }).id;
  });
}

// 批准一条档案修改：先按 P3 的规则批准，再落到档案上。生成提案之后档案被人改过的，拒绝覆盖。
export function approveProfileUpdate(db: Database, proposalId: string, now = Date.now()): void {
  db.transaction(() => {
    approve(db, proposalId, {}, now);
    const p = getProposal(db, proposalId)!;
    const change = JSON.parse(p.final_body ?? p.body) as { field: 'communication' | 'working_notes'; before: string | null; after: string };
    const current = getProfile(db, p.target)?.profile ?? { role: null, responsibilities: [], communication: null, working_notes: [] };
    if (change.field === 'communication' && current.communication !== change.before) {
      transition(db, proposalId, ['approved'], 'failed', { error: '档案在提案生成后被改过，请重新生成' }, now);
      return;
    }
    const next: Profile =
      change.field === 'communication' ? { ...current, communication: change.after } : { ...current, working_notes: [...current.working_notes, change.after] };
    db.query(
      `INSERT INTO profiles (subject, profile, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(subject) DO UPDATE SET profile = excluded.profile, updated_at = excluded.updated_at`,
    ).run(p.target, JSON.stringify(next), now);
    transition(db, proposalId, ['approved'], 'done', {}, now);
  })();
}
