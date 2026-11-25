import { describe, expect, test } from 'bun:test';
import { call, FakeModel } from '../src/fake-model';
import { alignment } from '../evals/align';
import { pickCandidates } from '../evals/from-traces';
import { gradeAssertions } from '../evals/graders/code';
import { passAtK, passHatK, summarize } from '../evals/metrics';
import { diffBaseline } from '../evals/report';
import { runEval } from '../evals/runner';
import { agentTarget, createTodoEnv, triageTarget } from '../evals/targets';
import type { EvalTask, Target, TrialResult } from '../evals/types';

const task = (id: string, extra: Partial<EvalTask> = {}): EvalTask => ({
  id, suite: 'regression', target: 'triage', input: { n: id }, expect: [], judge: [], reference: null, tags: [], source: 'manual', ...extra,
});

describe('代码 grader', () => {
  // 拦：输出缺字段时被当作通过
  test('路径缺失算失败', () => {
    expect(gradeAssertions({}, [{ path: 'category', equals: 'bug' }])).toHaveLength(1);
    expect(gradeAssertions({}, [{ path: 'reply', excludes: '保证' }])).toHaveLength(1);
  });
  // 拦：嵌套路径、数组下标取值写错
  test('支持嵌套与数组下标', () => {
    const out = { todos: [{ title: '交周报', done: true }] };
    expect(gradeAssertions(out, [{ path: 'todos.0.done', equals: true }, { path: 'todos.0.title', includes: '周报' }])).toEqual([]);
  });
});

describe('指标', () => {
  // 拦：把 pass@k 与 pass^k 算反，或忘了 k 越大 pass^k 越低
  test('pass@k 随 k 上升，pass^k 随 k 下降', () => {
    expect(passAtK(4, 3, 1)).toBeCloseTo(0.75);
    expect(passHatK(4, 3, 1)).toBeCloseTo(0.75);
    expect(passAtK(4, 3, 2)).toBeCloseTo(1);
    expect(passHatK(4, 3, 2)).toBeCloseTo(0.5);
    expect(passHatK(5, 5, 5)).toBe(1);
    expect(passHatK(5, 0, 1)).toBe(0);
  });
  // 拦：大 n 时组合数溢出成 NaN
  test('试验次数多时数值稳定', () => {
    expect(passHatK(200, 150, 3)).toBeCloseTo((150 * 149 * 148) / (200 * 199 * 198), 6);
  });
});

describe('runner', () => {
  // 拦：试验之间共享状态，上一次的副作用污染下一次
  test('每次试验都是干净环境', async () => {
    const target: Target = async () => {
      const env = createTodoEnv(['交周报']);
      await env.tools[1]!.run({ title: '订会议室' }, {});
      return { output: env.state(), transcript: '' };
    };
    const results = await runEval([task('t1', { expect: [{ path: 'todos.1.title', equals: '订会议室' }] })], {
      k: 3, concurrency: 3, targets: { triage: target, agent: target }, judge: null,
    });
    expect(results.every((r) => r.verdict === 'pass')).toBe(true);
  });

  // 拦：并发上限失效，把模型的速率限制打爆
  test('同时运行的试验不超过并发上限', async () => {
    let running = 0;
    let peak = 0;
    const target: Target = async () => {
      running++;
      peak = Math.max(peak, running);
      await Bun.sleep(5);
      running--;
      return { output: {}, transcript: '' };
    };
    await runEval([task('a'), task('b'), task('c')], { k: 4, concurrency: 2, targets: { triage: target, agent: target }, judge: null });
    expect(peak).toBe(2);
  });

  // 拦：target 抛错时整个评测中断，或错误被当作通过
  test('target 抛错记为失败，不中断其他任务', async () => {
    let i = 0;
    const flaky: Target = async () => {
      if (i++ % 2 === 0) throw new Error('模型超时');
      return { output: {}, transcript: '' };
    };
    const results = await runEval([task('x')], { k: 4, concurrency: 1, targets: { triage: flaky, agent: flaky }, judge: null });
    expect(results.filter((r) => r.verdict === 'fail')).toHaveLength(2);
    expect(summarize(results, 2).passHatK).toBeCloseTo(1 / 6);
  });

  // 拦：判官说 unknown 时被当成通过
  test('判官无法判断时记为 unknown', async () => {
    const t: Target = async () => ({ output: { reply: '好的' }, transcript: '' });
    const results = await runEval([task('u', { judge: ['ignores_main_question'] })], {
      k: 1, concurrency: 1, targets: { triage: t, agent: t }, judge: async () => ({ verdict: 'unknown', reason: '缺上下文' }),
    });
    expect(results[0]!.verdict).toBe('unknown');
  });
});

describe('基线对比与判官对齐', () => {
  const r = (taskId: string, pass: boolean): TrialResult => ({
    taskId, trial: 0, verdict: pass ? 'pass' : 'fail', failures: [], output: null, error: null, ms: 0,
  });
  // 拦：回归被平均数掩盖（一个任务坏了、另一个变好，总分不变）
  test('逐任务找出回归与修复', () => {
    const d = diffBaseline([r('a', false), r('b', true)], [r('a', true), r('b', false)]);
    expect(d).toEqual({ regressions: ['a'], fixes: ['b'] });
  });
  // 拦：TPR/TNR 的分母用错
  test('对齐指标', () => {
    const human = [
      { key: '1', verdict: 'pass' as const }, { key: '2', verdict: 'pass' as const },
      { key: '3', verdict: 'fail' as const }, { key: '4', verdict: 'fail' as const },
    ];
    const judge = [
      { key: '1', verdict: 'pass' as const }, { key: '2', verdict: 'fail' as const },
      { key: '3', verdict: 'fail' as const }, { key: '4', verdict: 'pass' as const },
    ];
    const a = alignment(human, judge);
    expect([a.tpr, a.tnr]).toEqual([0.5, 0.5]);
    expect(a.confusion.fp).toBe(1);
  });
  // 拦：同一个输入反复进候选集；正常通过的样本也被收进来
  test('只收出错或被拒绝、改写的 trace，并按输入去重', () => {
    const base = { ts: '', target: 'triage' as const, output: null };
    const picked = pickCandidates([
      { ...base, id: '1', input: { a: 1 }, error: null, feedback: 'approved' },
      { ...base, id: '2', input: { a: 2 }, error: '超时', feedback: null },
      { ...base, id: '3', input: { a: 2 }, error: null, feedback: 'rejected' },
      { ...base, id: '4', input: { a: 3 }, error: null, feedback: 'edited' },
    ], new Set());
    expect(picked.map((p) => p.source)).toEqual(['trace:2', 'trace:4']);
  });
});

describe('评测对象接上真实管线', () => {
  // 拦：评测对象和 P1/P2 的接口没接对（字段名、路由、工具参数），导致整套评测在真实模型上一跑就全错
  test('分诊与 agent 两类任务都能按代码 grader 判出通过', async () => {
    const tasks = (await Bun.file('evals/tasks.jsonl').text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as EvalTask);
    const filter = tasks.find((t) => t.id === 'triage-export-filter')!;
    const dup = tasks.find((t) => t.id === 'agent-add-dup')!;
    const triageModel = new FakeModel([
      {
        toolCalls: [
          call('emit_result', {
            summary: '希望月报导出支持按部门筛选',
            category: 'request',
            urgency: 'normal',
            needs_reply: true,
            todos: [],
            missing_info: [],
            reply_draft: '收到，我先确认可行性，周五前答复你。',
            confidence: 0.8,
          }),
        ],
      },
    ]);
    const agentModel = new FakeModel([
      { toolCalls: [call('add_todo', { title: '交周报' })] },
      { content: '清单里已存在「交周报」，没有重复添加。' },
    ]);
    const [t] = await runEval([filter], { k: 1, concurrency: 1, targets: { triage: triageTarget(triageModel), agent: agentTarget(agentModel) }, judge: null });
    const [a] = await runEval([dup], { k: 1, concurrency: 1, targets: { triage: triageTarget(triageModel), agent: agentTarget(agentModel) }, judge: null });
    expect([t!.verdict, a!.verdict]).toEqual(['pass', 'pass']);
  });
});
