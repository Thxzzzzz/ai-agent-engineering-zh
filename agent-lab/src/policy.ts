import type { Database } from 'bun:sqlite';

// 策略层：决定一条新提案是等人批准（suggest），还是可以自动批准（auto）。
// 默认一切 suggest；auto 必须按对象显式开启，而且每条护栏都要通过。
export type Mode = 'off' | 'suggest' | 'auto';
export type Policy = {
  modes: Record<string, Mode>; // 按发送对象设置；没设置的用 defaultMode
  defaultMode: Mode;
  minConfidence: number;
  maxAutoPerHour: number;
  denyKeywords: string[];
  quietHours: { start: number; end: number } | null; // 本地小时，支持跨午夜，如 { start: 22, end: 8 }
};

export const defaultPolicy: Policy = {
  modes: {},
  defaultMode: 'suggest',
  minConfidence: 0.85,
  maxAutoPerHour: 3,
  denyKeywords: ['合同', '报价', '付款', '薪资', '密码', '离职', '法务'],
  quietHours: { start: 22, end: 8 },
};

export type Decision = { action: 'drop' | 'pending' | 'auto'; reasons: string[] };

export function decide(
  db: Database,
  policy: Policy,
  p: { target: string; body: string; confidence: number; sourceText: string },
  now = new Date(),
): Decision {
  const mode = policy.modes[p.target] ?? policy.defaultMode;
  if (mode === 'off') return { action: 'drop', reasons: ['该对象已关闭'] };
  if (mode === 'suggest') return { action: 'pending', reasons: ['该对象需要人工审批'] };

  const reasons: string[] = [];
  if (p.confidence < policy.minConfidence) reasons.push(`置信度 ${p.confidence} 低于 ${policy.minConfidence}`);
  const hit = policy.denyKeywords.find((k) => p.body.includes(k) || p.sourceText.includes(k));
  if (hit) reasons.push(`命中敏感词「${hit}」`);
  const { n } = db
    .query('SELECT COUNT(*) AS n FROM proposals WHERE target = ? AND auto_approved = 1 AND created_at > ?')
    .get(p.target, now.getTime() - 3600_000) as { n: number };
  if (n >= policy.maxAutoPerHour) reasons.push(`近 1 小时已自动发送 ${n} 条`);
  if (policy.quietHours && inQuietHours(now.getHours(), policy.quietHours)) reasons.push('静默时段');
  return reasons.length ? { action: 'pending', reasons } : { action: 'auto', reasons: ['全部护栏通过'] };
}

const inQuietHours = (h: number, q: { start: number; end: number }) => (q.start <= q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end);
