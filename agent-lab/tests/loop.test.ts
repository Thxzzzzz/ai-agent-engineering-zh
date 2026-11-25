import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call, FakeModel } from '../src/fake-model';
import { AgentError, runAgent } from '../src/loop';
import { calculator, createReadNote, evaluate } from '../src/tools';

const base = { system: '测试', tools: [calculator] };

describe('runAgent', () => {
  test('工具结果回灌给模型，模型不再调用工具时返回文本', async () => {
    const model = new FakeModel([{ toolCalls: [call('calculator', { expression: '6*7' }, 'c1')] }, { content: '答案是 42' }]);
    const r = await runAgent('6 乘 7 是多少', { ...base, model });
    expect(r.text).toBe('答案是 42');
    expect(r.steps).toBe(2);
    // 拦：忘了把工具结果追加进上下文，模型第二轮看不到 42
    expect(model.requests[1]!.messages.at(-1)).toEqual({ role: 'tool', toolCallId: 'c1', content: '42', isError: false });
  });

  test('调用不存在的工具：错误回灌、循环继续，而不是崩溃', async () => {
    const model = new FakeModel([{ toolCalls: [call('web_search', { q: 'x' })] }, { content: '我没有搜索工具' }]);
    const r = await runAgent('搜一下', { ...base, model });
    const fed = model.requests[1]!.messages.at(-1);
    expect(fed).toMatchObject({ role: 'tool', isError: true });
    expect(r.text).toBe('我没有搜索工具');
  });

  test('参数不合法时不执行工具，把字段级错误回灌', async () => {
    let ran = false;
    const spy = { ...calculator, run: async () => ((ran = true), '0') };
    const model = new FakeModel([{ toolCalls: [call('calculator', { expr: '1+1' })] }, { content: '好' }]);
    await runAgent('算', { ...base, tools: [spy], model });
    expect(ran).toBe(false);
    const fed = model.requests[1]!.messages.at(-1) as { content: string; isError: boolean };
    expect(fed.isError).toBe(true);
    expect(fed.content).toContain('expression');
  });

  test('超过最大步数抛 AgentError，并带上完整消息记录', async () => {
    const loopForever = () => ({ toolCalls: [call('calculator', { expression: '1+1' })] });
    const model = new FakeModel([loopForever, loopForever, loopForever]);
    const err = await runAgent('绕圈', { ...base, model, maxSteps: 3 }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).messages.length).toBe(2 + 3 * 2);
  });

  test('叫停后不再请求模型', async () => {
    const controller = new AbortController();
    const model = new FakeModel([
      () => (controller.abort(), { toolCalls: [call('calculator', { expression: '1+1' })] }),
      { content: '不应该走到这里' },
    ]);
    await expect(runAgent('算', { ...base, model, signal: controller.signal })).rejects.toThrow();
    expect(model.requests.length).toBe(1);
  });

  test('拒答直接抛错，不当作正常答案返回', async () => {
    const model = new FakeModel([{ content: '抱歉，无法协助', stopReason: 'refusal' }]);
    await expect(runAgent('x', { ...base, model })).rejects.toThrow('拒绝');
  });
});

describe('工具', () => {
  test('read_note 拒绝目录之外的路径', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notes-'));
    writeFileSync(join(dir, 'weekly.md'), '周报模板');
    const readNote = createReadNote(dir);
    expect(await readNote.run({ name: 'weekly.md' }, {})).toBe('周报模板');
    await expect(readNote.run({ name: '../../etc/passwd' }, {})).rejects.toThrow('只能读取');
    await expect(readNote.run({ name: '/etc/passwd' }, {})).rejects.toThrow('只能读取');
  });

  test('calculator 只做算术，不执行任何代码', () => {
    expect(evaluate('(1200 - 300) * 2 / 3')).toBe(600);
    expect(evaluate('-3 + 5')).toBe(2);
    expect(() => evaluate('process.exit(1)')).toThrow();
    expect(() => evaluate('1 / 0')).toThrow('除数为 0');
  });
});
