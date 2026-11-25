import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { call, FakeModel } from '../src/fake-model';
import { completeStructured, StructuredOutputError } from '../src/structured';

const Schema = z.strictObject({ title: z.string(), priority: z.enum(['low', 'high']) });
const req = { schema: Schema, system: '提取任务', user: '月报导出加个按部门筛选，比较急' };
const usage = { inputTokens: 100, outputTokens: 10, cachedInputTokens: 0 };

describe('completeStructured', () => {
  test('一次合法就返回，只发出一个工具定义', async () => {
    const model = new FakeModel([{ toolCalls: [call('emit_result', { title: '月报导出加部门筛选', priority: 'high' })] }]);
    const r = await completeStructured(model, req);
    expect(r).toMatchObject({ value: { title: '月报导出加部门筛选', priority: 'high' }, attempts: 1 });
    expect(model.requests[0]!.tools.map((t) => t.name)).toEqual(['emit_result']);
  });

  test('不合法时把字段级错误回灌，第二次合法即成功，用量跨次累加', async () => {
    const model = new FakeModel([
      { toolCalls: [call('emit_result', { title: '月报筛选', priority: 'urgent' }, 'a1')], usage },
      { toolCalls: [call('emit_result', { title: '月报筛选', priority: 'high' }, 'a2')], usage },
    ]);
    const r = await completeStructured(model, req);
    expect(r.attempts).toBe(2);
    expect(r.usage.inputTokens).toBe(200);
    // 拦：不回灌直接重试（模型不知道错在哪）或回灌的信息里没有出错的字段
    const fed = model.requests[1]!.messages.at(-1) as { role: string; toolCallId: string; isError: boolean; content: string };
    expect(fed).toMatchObject({ role: 'tool', toolCallId: 'a1', isError: true });
    expect(fed.content).toContain('priority');
  });

  test('模型没调用工具时提醒它调用', async () => {
    const model = new FakeModel([{ content: '好的，这是结果：……' }, { toolCalls: [call('emit_result', { title: 'x', priority: 'low' })] }]);
    const r = await completeStructured(model, req);
    expect(r.attempts).toBe(2);
    expect(model.requests[1]!.messages.at(-1)).toMatchObject({ role: 'user' });
  });

  test('一直不合法：用完次数后抛 invalid，不无限重试', async () => {
    const bad = { toolCalls: [call('emit_result', { title: 1 })] };
    const model = new FakeModel([bad, bad, bad, bad]);
    const err = await completeStructured(model, req).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect(err.reason).toBe('invalid');
    expect(model.requests.length).toBe(3);
  });

  test('拒答与截断立即失败，不浪费重试', async () => {
    for (const stopReason of ['refusal', 'max_tokens'] as const) {
      const model = new FakeModel([{ content: '', stopReason }, { toolCalls: [call('emit_result', { title: 'x', priority: 'low' })] }]);
      const err = await completeStructured(model, req).catch((e) => e);
      expect(err.reason).toBe(stopReason);
      expect(model.requests.length).toBe(1);
    }
  });
});
