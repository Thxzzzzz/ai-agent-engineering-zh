import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

export type Memory = {
  id: string;
  subject: string;
  content: string;
  source_message_id: string;
  importance: number;
  origin: 'auto' | 'manual';
  created_at: number;
  last_accessed_at: number;
  valid_from: number;
  valid_to: number | null;
  supersedes: string | null;
};

export type NewMemory = Pick<Memory, 'subject' | 'content' | 'source_message_id' | 'importance' | 'origin'> & {
  valid_from?: number;
  supersedes?: string | null;
};

export function insertMemory(db: Database, m: NewMemory, now = Date.now()): Memory {
  const id = randomUUID().slice(0, 8);
  db.transaction(() => {
    db.query(
      `INSERT INTO memories (id, subject, content, source_message_id, importance, origin, created_at, last_accessed_at, valid_from, supersedes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, m.subject, m.content, m.source_message_id, m.importance, m.origin, now, now, m.valid_from ?? now, m.supersedes ?? null);
    db.query('INSERT INTO memories_fts (memory_id, subject, content) VALUES (?, ?, ?)').run(id, m.subject, m.content);
  })();
  return getMemory(db, id)!;
}

export const getMemory = (db: Database, id: string) => db.query('SELECT * FROM memories WHERE id = ?').get(id) as Memory | null;

// 失效而不是删除：旧事实留着，标明它到什么时候为止成立。"以前谁负责"这类问题还答得上来，出错也能追查。
export const invalidate = (db: Database, id: string, at = Date.now()) =>
  db.query('UPDATE memories SET valid_to = ? WHERE id = ? AND valid_to IS NULL').run(at, id).changes === 1;

export const validMemories = (db: Database, subject: string) =>
  db.query('SELECT * FROM memories WHERE subject = ? AND valid_to IS NULL ORDER BY valid_from').all(subject) as Memory[];

// trigram 分词：把查询拆成三字片段再 OR 起来，命中的片段越多 bm25 越靠前。中文不需要额外的分词器。
export function ftsQuery(text: string): string | null {
  const grams = new Set<string>();
  for (const word of text.split(/[\s\p{P}\p{S}]+/u)) {
    const chars = Array.from(word);
    for (let i = 0; i + 3 <= chars.length; i++) grams.add(chars.slice(i, i + 3).join(''));
  }
  if (grams.size === 0) return null;
  return [...grams].slice(0, 64).map((g) => `"${g.replaceAll('"', '""')}"`).join(' OR ');
}

export type Candidate = Memory & { bm25: number };

// 按关键词找仍然有效的相似记忆（只看有效的：失效的事实不该再影响判断）。
export function searchMemories(db: Database, text: string, opts: { subject?: string; limit?: number } = {}): Candidate[] {
  const q = ftsQuery(text);
  if (!q) return [];
  const rows = db
    .query(
      `SELECT m.*, bm25(memories_fts) AS bm25 FROM memories_fts f JOIN memories m ON m.id = f.memory_id
       WHERE memories_fts MATCH ? AND m.valid_to IS NULL ${opts.subject ? 'AND m.subject = ?' : ''}
       ORDER BY bm25 LIMIT ?`,
    )
    .all(...(opts.subject ? [q, opts.subject, opts.limit ?? 20] : [q, opts.limit ?? 20])) as Candidate[];
  return rows;
}

// 用户要求"忘掉某人"时是真删除：记忆、索引、档案一起删。（自动更新用失效，用户删除用删除，两件事别混。）
export function forget(db: Database, subject: string): number {
  let n = 0;
  db.transaction(() => {
    db.query('DELETE FROM memories_fts WHERE subject = ?').run(subject);
    db.query('UPDATE memories SET supersedes = NULL WHERE supersedes IN (SELECT id FROM memories WHERE subject = ?)').run(subject);
    n = db.query('DELETE FROM memories WHERE subject = ?').run(subject).changes;
    db.query('DELETE FROM profiles WHERE subject = ?').run(subject);
  })();
  return n;
}
