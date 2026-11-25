import { failureCounts, summarize, taskStats } from './metrics';
import type { TrialResult } from './types';

export type Diff = { regressions: string[]; fixes: string[] };

// 与基线逐任务比较：以前每次都过、现在有失败 = 回归；以前有失败、现在每次都过 = 修复。
export function diffBaseline(current: TrialResult[], baseline: TrialResult[]): Diff {
  const before = new Map(taskStats(baseline).map((s) => [s.taskId, s.rate]));
  const regressions: string[] = [];
  const fixes: string[] = [];
  for (const s of taskStats(current)) {
    const b = before.get(s.taskId);
    if (b === undefined) continue;
    if (b === 1 && s.rate < 1) regressions.push(s.taskId);
    if (b < 1 && s.rate === 1) fixes.push(s.taskId);
  }
  return { regressions, fixes };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function renderReport(results: TrialResult[], k: number, baseline: TrialResult[] | null): string {
  const s = summarize(results, k);
  const lines = [
    '# 评测报告',
    '',
    `| 任务数 | pass@1 | pass@${k} | pass^${k} | 判官无法判断的试验 |`,
    '|---|---|---|---|---|',
    `| ${s.tasks} | ${pct(s.passAt1)} | ${pct(s.passAtK)} | ${pct(s.passHatK)} | ${s.unknownTrials} |`,
    '',
    '## 失败模式',
    '',
    ...failureCounts(results).map(([mode, n]) => `- ${mode}：${n} 次`),
  ];
  if (baseline) {
    const b = summarize(baseline, k);
    const d = diffBaseline(results, baseline);
    lines.push(
      '',
      '## 与基线对比',
      '',
      `pass@1 ${pct(b.passAt1)} → ${pct(s.passAt1)}，pass^${k} ${pct(b.passHatK)} → ${pct(s.passHatK)}`,
      '',
      `回归（以前全过、现在有失败）：${d.regressions.join('、') || '无'}`,
      `修复（以前有失败、现在全过）：${d.fixes.join('、') || '无'}`,
    );
  }
  const failed = results.filter((r) => r.verdict !== 'pass');
  if (failed.length) {
    lines.push('', '## 失败明细（先读这些 transcript，再改提示词）', '');
    for (const r of failed.slice(0, 30)) lines.push(`- ${r.taskId}#${r.trial} [${r.verdict}] ${r.failures.map((f) => f.detail).join('；')}`);
  }
  return `${lines.join('\n')}\n`;
}
