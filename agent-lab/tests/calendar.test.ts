import { describe, expect, test } from 'bun:test';
import { SAMPLE_EVENTS, findFreeSlots, listEvents } from '../mcp-server/calendar';

describe('findFreeSlots', () => {
  // 拦：空档计算把会议时间也当成空闲（区间重叠判断写反）
  test('不与已有会议重叠', () => {
    const slots = findFreeSlots(SAMPLE_EVENTS, { from: '2026-12-01T00:00:00Z', to: '2026-12-02T00:00:00Z', durationMinutes: 60, limit: 10 });
    for (const s of slots) {
      for (const e of SAMPLE_EVENTS) {
        const overlap = Date.parse(s.start) < Date.parse(e.end) && Date.parse(e.start) < Date.parse(s.end);
        expect(overlap).toBe(false);
      }
    }
    expect(slots[0]).toEqual({ start: '2026-12-01T10:00:00.000Z', end: '2026-12-01T11:00:00.000Z' });
  });

  // 拦：忘了限制在工作时间内，或把下班前不足时长的零头也算进去
  test('只在工作时间内，且时长放得下', () => {
    const slots = findFreeSlots(SAMPLE_EVENTS, { from: '2026-12-01T00:00:00Z', to: '2026-12-02T00:00:00Z', durationMinutes: 120, limit: 10 });
    for (const s of slots) {
      expect(new Date(s.start).getUTCHours()).toBeGreaterThanOrEqual(9);
      expect(Date.parse(s.end)).toBeLessThanOrEqual(Date.parse('2026-12-01T18:00:00Z'));
    }
  });

  // 拦：周末也排会
  test('跳过周末', () => {
    // 2026-12-05、06 是周六、周日
    const slots = findFreeSlots([], { from: '2026-12-05T00:00:00Z', to: '2026-12-07T00:00:00Z', durationMinutes: 30, limit: 5 });
    expect(slots).toEqual([]);
  });

  // 拦：时间范围反了也照常返回，模型得不到可修正的错误
  test('范围无效时给出可执行的错误信息', () => {
    expect(() => listEvents(SAMPLE_EVENTS, '2026-12-02T00:00:00Z', '2026-12-01T00:00:00Z', null)).toThrow('from 必须早于 to');
  });
});
