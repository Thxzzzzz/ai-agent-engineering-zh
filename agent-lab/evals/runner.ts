import { gradeAssertions } from './graders/code';
import type { EvalTask, Failure, JudgeFn, Target, TrialResult, Verdict } from './types';

export type RunOptions = {
  k: number;                                   // 每个任务跑几次
  concurrency: number;                         // 同时在跑的试验上限（受限于模型的速率限制）
  targets: Record<EvalTask['target'], Target>;
  judge: JudgeFn | null;                       // null = 只跑代码 grader（快、免费）
  onProgress?: (done: number, total: number) => void;
};

// 简单的并发闸门：最多 limit 个任务同时执行。
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function runTrial(task: EvalTask, trial: number, opts: RunOptions): Promise<TrialResult> {
  const started = performance.now();
  try {
    // 每次试验都调用 target 重新建环境，试验之间不共享任何状态。
    const run = await opts.targets[task.target](task.input);
    const failures: Failure[] = gradeAssertions(run.output, task.expect);
    let unknown = false;
    // 代码 grader 已经判失败时不再花钱问判官
    if (failures.length === 0 && opts.judge) {
      for (const mode of task.judge) {
        const j = await opts.judge(mode, task, run);
        if (j.verdict === 'fail') failures.push({ mode, detail: j.reason });
        if (j.verdict === 'unknown') unknown = true;
      }
    }
    const verdict: Verdict = failures.length ? 'fail' : unknown ? 'unknown' : 'pass';
    return { taskId: task.id, trial, verdict, failures, output: run.output, error: null, ms: performance.now() - started };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      taskId: task.id, trial, verdict: 'fail', failures: [{ mode: 'error', detail: message }],
      output: null, error: message, ms: performance.now() - started,
    };
  }
}

export async function runEval(tasks: EvalTask[], opts: RunOptions): Promise<TrialResult[]> {
  const jobs = tasks.flatMap((task) => Array.from({ length: opts.k }, (_, trial) => ({ task, trial })));
  let done = 0;
  return mapLimit(jobs, opts.concurrency, async ({ task, trial }) => {
    const r = await runTrial(task, trial, opts);
    opts.onProgress?.(++done, jobs.length);
    return r;
  });
}

export async function loadTasks(path: string): Promise<EvalTask[]> {
  const text = await Bun.file(path).text();
  const tasks = text.split('\n').filter((l) => l.trim()).map((l, i) => {
    try {
      return JSON.parse(l) as EvalTask;
    } catch {
      throw new Error(`${path} 第 ${i + 1} 行不是合法 JSON`);
    }
  });
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`任务 id 重复：${t.id}`);
    ids.add(t.id);
  }
  return tasks;
}
