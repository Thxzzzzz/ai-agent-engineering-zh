// 从线上 trace 挑出值得变成评测任务的样本：出错的、被用户拒绝或改写的。
// 用法：bun evals/from-traces.ts traces/*.jsonl > evals/candidates.jsonl
// trace 每行 { id, ts, target, input, output, error, feedback }，feedback 取 'approved' | 'edited' | 'rejected' | null。
import { createHash } from 'node:crypto';
import type { EvalTask } from './types';

type TraceLine = {
  id: string;
  ts: string;
  target: EvalTask['target'];
  input: unknown;
  output: unknown;
  error: string | null;
  feedback: 'approved' | 'edited' | 'rejected' | null;
};

export function pickCandidates(lines: TraceLine[], existingInputs: Set<string>): EvalTask[] {
  const seen = new Set(existingInputs);
  const out: EvalTask[] = [];
  for (const t of lines) {
    const interesting = t.error !== null || t.feedback === 'edited' || t.feedback === 'rejected';
    if (!interesting) continue;
    const fp = createHash('sha256').update(JSON.stringify(t.input)).digest('hex').slice(0, 16);
    if (seen.has(fp)) continue; // 同样的输入只收一次
    seen.add(fp);
    out.push({
      id: `${t.target}-${fp}`,
      suite: 'capability', // 先进能力集，修好并稳定通过后再"毕业"进回归集
      target: t.target,
      input: t.input,
      expect: [],          // 由人补上：期望的字段与判官要查的失败模式
      judge: [],
      reference: null,
      tags: [t.error ? 'error' : `feedback:${t.feedback}`],
      source: `trace:${t.id}`,
    });
  }
  return out;
}

export function inputFingerprint(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  const lines: TraceLine[] = [];
  for (const f of files) {
    for (const l of (await Bun.file(f).text()).split('\n')) if (l.trim()) lines.push(JSON.parse(l) as TraceLine);
  }
  const tasksFile = Bun.file('evals/tasks.jsonl');
  const existing = (await tasksFile.exists())
    ? new Set((await tasksFile.text()).split('\n').filter((l) => l.trim()).map((l) => inputFingerprint((JSON.parse(l) as EvalTask).input)))
    : new Set<string>();
  for (const c of pickCandidates(lines, existing)) console.log(JSON.stringify(c));
}
