import type { Database } from 'bun:sqlite';
import { type Candidate, searchMemories } from './store';

export type Weights = { recency: number; importance: number; relevance: number };
export type Embedder = { embed(texts: string[]): Promise<number[][]> };
export type Scored = Candidate & { score: number; parts: Weights };

// 检索打分（思路来自 Generative Agents）：最近性 + 重要性 + 相关性，三项各自归一到 0~1 后加权求和。
// 先用全文检索粗筛，再在候选里打分；给了 embedder 就用向量余弦替换关键词相关性。
export async function retrieve(
  db: Database,
  query: string,
  opts: { subject?: string; limit?: number; weights?: Weights; embedder?: Embedder; now?: number; decay?: number } = {},
): Promise<Scored[]> {
  const now = opts.now ?? Date.now();
  const w = opts.weights ?? { recency: 1, importance: 1, relevance: 1 };
  const candidates = searchMemories(db, query, { subject: opts.subject, limit: 30 });
  if (candidates.length === 0) return [];

  const hours = (t: number) => (now - t) / 3600_000;
  const recency = candidates.map((m) => (opts.decay ?? 0.995) ** hours(m.last_accessed_at));
  const importance = candidates.map((m) => m.importance / 10);
  const relevance = opts.embedder ? await cosineScores(opts.embedder, query, candidates) : candidates.map((m) => -m.bm25);

  const [r, i, v] = [normalize(recency), normalize(importance), normalize(relevance)];
  const scored = candidates
    .map((m, k) => {
      const parts = { recency: r[k]!, importance: i[k]!, relevance: v[k]! };
      return { ...m, parts, score: w.recency * parts.recency + w.importance * parts.importance + w.relevance * parts.relevance };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 5);

  // 被检索到也算一次"想起"：刷新最近访问时间，常用的记忆不容易沉底
  const touch = db.query('UPDATE memories SET last_accessed_at = ? WHERE id = ?');
  db.transaction(() => scored.forEach((m) => touch.run(now, m.id)))();
  return scored;
}

function normalize(xs: number[]): number[] {
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return xs.map((x) => (max === min ? 1 : (x - min) / (max - min)));
}

async function cosineScores(embedder: Embedder, query: string, cs: Candidate[]): Promise<number[]> {
  const [q, ...vs] = await embedder.embed([query, ...cs.map((c) => c.content)]);
  const dot = (a: number[], b: number[]) => a.reduce((s, x, k) => s + x * (b[k] ?? 0), 0);
  const norm = (a: number[]) => Math.sqrt(dot(a, a)) || 1;
  return vs.map((v) => dot(q!, v) / (norm(q!) * norm(v)));
}
