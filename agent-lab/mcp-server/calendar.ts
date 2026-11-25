// 日程数据与查询逻辑。与 MCP 无关，单独可测。
export type CalEvent = { id: string; title: string; start: string; end: string; attendees: string[] };
export type Slot = { start: string; end: string };

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export const SAMPLE_EVENTS: CalEvent[] = [
  { id: 'e1', title: '周会', start: '2026-12-01T09:00:00Z', end: '2026-12-01T10:00:00Z', attendees: ['me', 'alice', 'bob'] },
  { id: 'e2', title: '月报评审', start: '2026-12-01T14:00:00Z', end: '2026-12-01T15:30:00Z', attendees: ['me', 'carol'] },
  { id: 'e3', title: '客户电话', start: '2026-12-02T10:30:00Z', end: '2026-12-02T11:00:00Z', attendees: ['me'] },
];

export const WORKING_HOURS = { start: '09:00', end: '18:00', timezone: 'UTC', weekdaysOnly: true };

function minutesOf(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return (h * 60 + m) * MIN;
}

function parseRange(from: string, to: string): [number, number] {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error('时间格式无效，请使用 ISO 8601，例如 2026-12-01T09:00:00Z');
  if (a >= b) throw new Error('from 必须早于 to');
  if (b - a > 31 * DAY) throw new Error('查询范围不能超过 31 天，请缩小范围');
  return [a, b];
}

export function listEvents(events: CalEvent[], from: string, to: string, keyword: string | null): CalEvent[] {
  const [a, b] = parseRange(from, to);
  return events
    .filter((e) => Date.parse(e.end) > a && Date.parse(e.start) < b)
    .filter((e) => (keyword ? e.title.includes(keyword) : true))
    .sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
}

// 在工作时间内找出能容纳 durationMinutes 的空档，每个空档只给最早的一个时段。
export function findFreeSlots(
  events: CalEvent[],
  q: { from: string; to: string; durationMinutes: number; limit: number },
): Slot[] {
  const [from, to] = parseRange(q.from, q.to);
  const need = q.durationMinutes * MIN;
  const busy = events
    .map((e) => [Date.parse(e.start), Date.parse(e.end)] as const)
    .filter(([s, e]) => e > from && s < to)
    .sort((x, y) => x[0] - y[0]);
  const slots: Slot[] = [];
  const push = (start: number) => slots.push({ start: new Date(start).toISOString(), end: new Date(start + need).toISOString() });

  for (let day = Math.floor(from / DAY) * DAY; day < to && slots.length < q.limit; day += DAY) {
    const weekday = new Date(day).getUTCDay();
    if (WORKING_HOURS.weekdaysOnly && (weekday === 0 || weekday === 6)) continue;
    let cursor = Math.max(from, day + minutesOf(WORKING_HOURS.start));
    const dayEnd = Math.min(to, day + minutesOf(WORKING_HOURS.end));
    for (const [s, e] of busy) {
      if (e <= cursor || s >= dayEnd) continue;
      if (s - cursor >= need) push(cursor);
      cursor = Math.max(cursor, e);
    }
    if (dayEnd - cursor >= need) push(cursor);
  }
  return slots.slice(0, q.limit);
}
