// 用 MCP 日程工具跑一次 agent。先 bun run mcp-pin 审阅工具定义并生成 mcp-lock.json。
import { runAgent } from './loop';
import { connectMcp } from './mcp-client';
import { OpenAICompatibleModel } from './models/openai-compatible';

const lockFile = Bun.file('mcp-lock.json');
if (!(await lockFile.exists())) {
  console.error('还没有 mcp-lock.json：先运行 bun run mcp-pin，审阅工具描述后再来。');
  process.exit(1);
}
const lock = (await lockFile.json()) as { calendar: Record<string, string> };
const model = OpenAICompatibleModel.fromEnv(); // 先读模型配置：缺配置时不必启动 MCP 服务

const calendar = await connectMcp({
  name: 'calendar',
  command: 'bun',
  args: ['mcp-server/index.ts'],
  allowTools: ['list_events', 'find_free_slots', 'create_event_draft'],
  pins: lock.calendar,
});

try {
  const result = await runAgent('帮我在 12 月 1 日到 2 日之间找一个 45 分钟的时间，和 alice、carol 过一下月报，起草邀请。', {
    model,
    tools: calendar.tools,
    system: '你是日程助手。安排会议时先查空闲时段，再起草邀请；草稿需要用户确认，不要声称已经创建。今天是 2026-11-30（UTC）。',
  });
  console.log(result.text);
} finally {
  await calendar.close();
}
