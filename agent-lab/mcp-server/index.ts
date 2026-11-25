import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { SAMPLE_EVENTS, WORKING_HOURS, findFreeSlots, listEvents } from './calendar';

// stdio 传输下 stdout 专用于协议消息：日志一律写 stderr，否则客户端会解析失败。
const log = (...args: unknown[]) => console.error('[calendar]', ...args);

const Iso = z.iso.datetime().describe('ISO 8601 UTC 时间，例如 2026-12-01T09:00:00Z');
const EventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  attendees: z.array(z.string()),
});

const server = new McpServer({ name: 'calendar', version: '0.1.0' });

server.registerTool(
  'list_events',
  {
    title: '列出日程',
    description:
      '列出时间范围内的日程（最多 31 天），可按标题关键词过滤。用于回答"某天有什么会""某个会在什么时候"。只读。',
    inputSchema: z.object({
      from: Iso,
      to: Iso,
      keyword: z.string().nullable().describe('标题关键词；不过滤时传 null'),
    }),
    outputSchema: z.object({ events: z.array(EventSchema) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ from, to, keyword }) => {
    const events = listEvents(SAMPLE_EVENTS, from, to, keyword);
    const text = events.length
      ? events.map((e) => `${e.start} ~ ${e.end} ${e.title}（${e.attendees.length} 人）`).join('\n')
      : '这段时间没有日程。';
    return { content: [{ type: 'text', text }], structuredContent: { events } };
  },
);

server.registerTool(
  'find_free_slots',
  {
    title: '查找空闲时段',
    description:
      '在工作日 09:00–18:00（UTC）内查找能容纳指定时长的空闲时段，按时间先后返回。用于安排会议前找时间。只读。',
    inputSchema: z.object({
      from: Iso,
      to: Iso,
      durationMinutes: z.number().int().min(15).max(240).describe('会议时长，15–240 分钟'),
      limit: z.number().int().min(1).max(10).describe('最多返回几个时段，1–10'),
    }),
    outputSchema: z.object({ slots: z.array(z.object({ start: z.string(), end: z.string() })) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (q) => {
    const slots = findFreeSlots(SAMPLE_EVENTS, q);
    const text = slots.length
      ? slots.map((s, i) => `${i + 1}. ${s.start} ~ ${s.end}`).join('\n')
      : '没有符合条件的空闲时段。可以放宽时间范围或缩短时长。';
    return { content: [{ type: 'text', text }], structuredContent: { slots } };
  },
);

server.registerTool(
  'create_event_draft',
  {
    title: '起草会议邀请',
    description:
      '生成一份会议邀请草稿，供用户确认。不会写入日历、不会通知任何人；真正创建需要用户在应用里批准。',
    inputSchema: z.object({
      title: z.string().min(1).max(80),
      start: Iso,
      end: Iso,
      attendees: z.array(z.string()).max(20),
      agenda: z.string().max(500).nullable(),
    }),
    outputSchema: z.object({ draft: EventSchema.extend({ agenda: z.string().nullable(), status: z.literal('draft') }) }),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async (input) => {
    if (Date.parse(input.start) >= Date.parse(input.end)) throw new Error('start 必须早于 end');
    const draft = { id: `draft-${crypto.randomUUID()}`, status: 'draft' as const, ...input };
    log('生成草稿', draft.id);
    return {
      content: [{ type: 'text', text: `已生成草稿 ${draft.id}（未写入日历）：${input.title} ${input.start} ~ ${input.end}` }],
      structuredContent: { draft },
    };
  },
);

server.registerResource(
  'working-hours',
  'calendar://policy/working-hours',
  { title: '工作时间规则', mimeType: 'application/json' },
  async (uri) => ({ contents: [{ uri: uri.href, text: JSON.stringify(WORKING_HOURS) }] }),
);

await server.connect(new StdioServerTransport());
log('已就绪');
