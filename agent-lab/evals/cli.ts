// 用法：bun evals/cli.ts --suite regression --k 3 --concurrency 4 [--no-judge] [--min-pass 0.98] [--baseline evals/baseline.json] [--save-baseline]
import { parseArgs } from 'node:util';
import { OpenAICompatibleModel } from '../src/models/openai-compatible';
import { createJudge } from './graders/judge';
import { summarize, taskStats } from './metrics';
import { renderReport } from './report';
import { loadTasks, runEval } from './runner';
import { agentTarget, triageTarget } from './targets';
import type { TrialResult } from './types';

const { values: a } = parseArgs({
  options: {
    suite: { type: 'string', default: 'regression' },
    k: { type: 'string', default: '3' },
    concurrency: { type: 'string', default: '4' },
    'no-judge': { type: 'boolean', default: false },
    'min-pass': { type: 'string' },
    baseline: { type: 'string', default: 'evals/baseline.json' },
    'save-baseline': { type: 'boolean', default: false },
  },
});

const k = Number(a.k);
const tasks = (await loadTasks('evals/tasks.jsonl')).filter((t) => t.suite === a.suite);
if (tasks.length === 0) throw new Error(`没有 suite=${a.suite} 的任务`);

const model = OpenAICompatibleModel.fromEnv();
const results = await runEval(tasks, {
  k,
  concurrency: Number(a.concurrency),
  targets: { triage: triageTarget(model), agent: agentTarget(model) },
  judge: a['no-judge'] ? null : createJudge(model),
  onProgress: (done, total) => process.stderr.write(`\r${done}/${total}`),
});
process.stderr.write('\n');

const baselineFile = Bun.file(a.baseline);
const baseline = (await baselineFile.exists()) ? ((await baselineFile.json()) as TrialResult[]) : null;
const report = renderReport(results, k, baseline);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await Bun.write(`evals/results/${stamp}.json`, JSON.stringify(results, null, 2));
await Bun.write(`evals/results/${stamp}.md`, report);
console.log(report);
if (a['save-baseline']) await Bun.write(a.baseline, JSON.stringify(results, null, 2));

// CI 闸门：整体通过率达标，且没有一次都没过的任务。
if (a['min-pass']) {
  const s = summarize(results, k);
  const dead = taskStats(results).filter((t) => t.passed === 0).map((t) => t.taskId);
  if (s.passAt1 < Number(a['min-pass']) || dead.length) {
    console.error(`未达标：pass@1=${s.passAt1.toFixed(3)}，要求 ≥ ${a['min-pass']}；全部失败的任务：${dead.join('、') || '无'}`);
    process.exit(1);
  }
}
