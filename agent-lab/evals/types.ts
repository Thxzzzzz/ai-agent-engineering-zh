// 评测的数据结构。任务写在 evals/tasks.jsonl，每行一个 EvalTask。
export type Assertion =
  | { path: string; equals: unknown }
  | { path: string; oneOf: unknown[] }
  | { path: string; includes: string }
  | { path: string; excludes: string }
  | { path: string; matches: string };

export type EvalTask = {
  id: string;
  suite: 'regression' | 'capability'; // 回归集应接近全过；能力集一开始通过率偏低是正常的
  target: 'triage' | 'agent';
  input: unknown;
  expect: Assertion[];                // 代码 grader：能用代码判的都用代码判
  judge: string[];                    // 需要 LLM 判官检查的失败模式 id（见 failure-modes.ts）
  reference: string | null;           // 参考答案，给人和判官看
  tags: string[];
  source: string;                     // manual 或 trace:<id>
};

export type Verdict = 'pass' | 'fail' | 'unknown';

export type Failure = { mode: string; detail: string };

export type TrialResult = {
  taskId: string;
  trial: number;
  verdict: Verdict;
  failures: Failure[];
  output: unknown;
  error: string | null;
  ms: number;
};

export type TargetRun = { output: unknown; transcript: string };
export type Target = (input: unknown) => Promise<TargetRun>;

export type JudgeResult = { verdict: Verdict; reason: string };
export type JudgeFn = (mode: string, task: EvalTask, run: TargetRun) => Promise<JudgeResult>;
