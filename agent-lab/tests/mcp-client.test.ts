import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ToolPinError, connectMcp, hashToolDefinition, truncateResult } from '../src/mcp-client';
import type { Tool } from '../src/tools';

const server = { command: 'bun', args: ['mcp-server/index.ts'] };
let pins: Record<string, string> = {};

beforeAll(async () => {
  // 测试里现场算出当前定义的哈希，模拟"已审阅并批准"
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport(server));
  const { tools } = await c.listTools();
  pins = Object.fromEntries(tools.map((t) => [t.name, hashToolDefinition(t as never)]));
  await c.close();
});

describe('connectMcp', () => {
  let close: (() => Promise<void>) | undefined;
  afterAll(() => close?.());

  // 拦：允许列表失效，server 的全部工具都暴露给了模型；或忘了加命名空间
  test('只暴露允许列表里的工具，并加前缀', async () => {
    const conn = await connectMcp({ name: 'calendar', ...server, allowTools: ['list_events'], pins });
    close = conn.close;
    expect(conn.tools.map((t) => t.name)).toEqual(['calendar__list_events']);
  });

  // 拦：工具描述被改（投毒或悄悄升级）后客户端照用不误
  test('定义与锁定的哈希不一致时拒绝连接', async () => {
    const bad = { ...pins, list_events: 'deadbeef' };
    await expect(connectMcp({ name: 'calendar', ...server, allowTools: ['list_events'], pins: bad })).rejects.toBeInstanceOf(ToolPinError);
  });

  // 拦：参数不合法时整个循环崩掉，模型拿不到可修正的错误
  test('参数不合法时以错误返回而不是断开连接', async () => {
    const conn = await connectMcp({ name: 'calendar', ...server, allowTools: ['find_free_slots'], pins });
    await expect(conn.tools[0]!.run({ from: '明天', to: '后天', durationMinutes: 30, limit: 3 }, {})).rejects.toThrow();
    // 连接仍可用
    const ok = await conn.tools[0]!.run({ from: '2026-12-01T00:00:00Z', to: '2026-12-02T00:00:00Z', durationMinutes: 30, limit: 1 }, {});
    expect(ok).toContain('2026-12-01T10:00:00.000Z');
    await conn.close();
  });

  // 拦：起草工具实际改了数据（最小权限被破坏）
  test('create_event_draft 不改变日程', async () => {
    const conn = await connectMcp({ name: 'calendar', ...server, allowTools: ['list_events', 'create_event_draft'], pins });
    const [list, draft] = conn.tools as [Tool, Tool];
    const range = { from: '2026-12-03T00:00:00Z', to: '2026-12-04T00:00:00Z', keyword: null };
    const before = await list.run(range, {});
    await draft.run({ title: '对齐', start: '2026-12-03T10:00:00Z', end: '2026-12-03T10:30:00Z', attendees: ['alice'], agenda: null }, {});
    expect(await list.run(range, {})).toBe(before);
    await conn.close();
  });
});

// 拦：大结果原样塞进上下文
test('超长结果被截断并附上缩小范围的建议', () => {
  const out = truncateResult('x'.repeat(10_000), 100);
  expect(out.length).toBeLessThan(200);
  expect(out).toContain('缩小');
});
