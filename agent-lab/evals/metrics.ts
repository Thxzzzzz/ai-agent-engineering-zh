import type { TrialResult } from './types';

// 组合数 C(n, k)，用连乘避免阶乘溢出。
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

// n 次试验里 c 次通过时，"k 次里至少一次通过"的无偏估计。
export function passAtK(n: number, c: number, k: number): number {
  if (k > n) throw new Error(`k=${k} 不能大于试验次数 n=${n}`);
  return 1 - comb(n - c, k) / comb(n, k);
}

// "k 次全部通过"的估计：面向用户的 agent 更该看这个，用户每次都要它成功。
export function passHatK(n: number, c: number, k: number): number {
  if (k > n) throw new Error(`k=${k} 不能大于试验次数 n=${n}`);
  return comb(c, k) / comb(n, k);
}

export type TaskStat = { taskId: string; n: number; passed: number; unknown: number; rate: number };

export function taskStats(results: TrialResult[]): TaskStat[] {
  const by = new Map<string, TrialResult[]>();
  for (const r of results) by.set(r.taskId, [...(by.get(r.taskId) ?? []), r]);
  return [...by.entries()].map(([taskId, rs]) => {
    const passed = rs.filter((r) => r.verdict === 'pass').length;
    return { taskId, n: rs.length, passed, unknown: rs.filter((r) => r.verdict === 'unknown').length, rate: passed / rs.length };
  });
}

export function summarize(results: TrialResult[], k: number) {
  const stats = taskStats(results);
  const mean = (f: (s: TaskStat) => number) => (stats.length ? stats.reduce((a, s) => a + f(s), 0) / stats.length : 0);
  return {
    tasks: stats.length,
    passAt1: mean((s) => s.rate),
    passAtK: mean((s) => passAtK(s.n, s.passed, Math.min(k, s.n))),
    passHatK: mean((s) => passHatK(s.n, s.passed, Math.min(k, s.n))),
    unknownTrials: stats.reduce((a, s) => a + s.unknown, 0),
  };
}

export function failureCounts(results: TrialResult[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const r of results) for (const f of r.failures) counts.set(f.mode, (counts.get(f.mode) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
