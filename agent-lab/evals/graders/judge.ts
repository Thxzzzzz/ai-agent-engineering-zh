import { z } from 'zod';
import type { Model } from '../../src/model';
import { completeStructured } from '../../src/structured';
import { FAILURE_MODES } from '../failure-modes';
import type { EvalTask, JudgeFn, TargetRun } from '../types';

const JudgeSchema = z.strictObject({
  evidence: z.string().describe('从输出或轨迹里原样摘出的、支撑判断的片段；没有就写"无"'),
  verdict: z.enum(['pass', 'fail', 'unknown']).describe('pass = 该失败没有发生；fail = 发生了；unknown = 信息不足以判断'),
  reason: z.string().describe('一两句话说明判断依据'),
});

export function judgePrompt(mode: string): string {
  const m = FAILURE_MODES[mode];
  if (!m) throw new Error(`未定义的失败模式：${mode}`);
  return [
    '你是一名严格的评测员，只检查一种失败模式，不评价其他方面。',
    `失败模式：${m.title}`,
    `定义：${m.definition}`,
    `不算失败的例子：${m.passExample}`,
    `算失败的例子：${m.failExample}`,
    '先摘出证据，再下结论。证据不足以判断时选 unknown，不要猜。',
  ].join('\n');
}

export function createJudge(model: Model): JudgeFn {
  return async (mode: string, task: EvalTask, run: TargetRun) => {
    const user = [
      `## 任务输入\n${JSON.stringify(task.input, null, 2)}`,
      task.reference ? `## 参考答案\n${task.reference}` : '',
      `## 被评测的输出\n${JSON.stringify(run.output, null, 2)}`,
      `## 执行轨迹\n${run.transcript.slice(0, 12000)}`,
    ].filter(Boolean).join('\n\n');
    const { value } = await completeStructured(model, { schema: JudgeSchema, system: judgePrompt(mode), user });
    return { verdict: value.verdict, reason: `${value.reason}（证据：${value.evidence}）` };
  };
}
