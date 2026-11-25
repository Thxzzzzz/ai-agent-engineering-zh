import { describe, expect, test } from 'bun:test';
import { call, FakeModel } from '../src/fake-model';
import { Batcher } from '../src/triage/batcher';
import { route, triageBatch } from '../src/triage/pipeline';
import type { Ticket, TicketAnalysis } from '../src/triage/schema';

const analysis = (over: Partial<TicketAnalysis> = {}): TicketAnalysis => ({
  summary: '月报导出需要按部门筛选',
  category: 'request',
  urgency: 'normal',
  needs_reply: true,
  todos: [],
  missing_info: [],
  reply_draft: '收到，我先确认一下范围。',
  confidence: 0.8,
  ...over,
});
const ticket = (id: string): Ticket => ({ id, from: '同事甲', channel: 'email', subject: '月报导出', body: '加个部门筛选', receivedAt: '2026-11-20T09:00:00Z' });

describe('route', () => {
  test('critical 一律升级，哪怕还缺信息', () => {
    expect(route(analysis({ urgency: 'critical', missing_info: ['影响哪些人？'] })).action).toBe('escalate');
  });
  test('缺信息先追问，优先于直接回复', () => {
    expect(route(analysis({ missing_info: ['默认导出全部部门吗？'] })).action).toBe('clarify');
  });
});

describe('triageBatch', () => {
  test('单张工单失败不影响其他工单，结果顺序与输入一致', async () => {
    const good = { toolCalls: [call('emit_result', analysis())] };
    const refuse = { content: '', stopReason: 'refusal' as const };
    // 并发 1，保证脚本按顺序消费
    const model = new FakeModel([good, refuse, good]);
    const results = await triageBatch(model, [ticket('t1'), ticket('t2'), ticket('t3')], { concurrency: 1, today: '2026-11-25' });
    expect(results.map((r) => [r.ticket.id, r.ok])).toEqual([['t1', true], ['t2', false], ['t3', true]]);
    // 拦：提示词版本没记下来，事后无法对照评测
    expect(results[0]!.prompt).toBe('triage@3');
    expect(model.requests[0]!.messages[0]!.content).toContain('今天是 2026-11-25');
  });
});

describe('Batcher', () => {
  test('同一来源连发的消息在安静后合成一批', async () => {
    const flushed: [string, string[]][] = [];
    const b = new Batcher<string>({ quietMs: 30, maxItems: 10 }, (k, items) => flushed.push([k, items]));
    b.add('甲', '月报导出');
    b.add('甲', '加个部门筛选');
    b.add('乙', '权限申请');
    await Bun.sleep(60);
    expect(flushed).toContainEqual(['甲', ['月报导出', '加个部门筛选']]);
    expect(flushed).toContainEqual(['乙', ['权限申请']]);
  });
  test('攒满上限立刻处理，不等安静', () => {
    const flushed: string[][] = [];
    const b = new Batcher<string>({ quietMs: 10_000, maxItems: 2 }, (_, items) => flushed.push(items));
    b.add('甲', '1');
    b.add('甲', '2');
    expect(flushed).toEqual([['1', '2']]);
  });
});
