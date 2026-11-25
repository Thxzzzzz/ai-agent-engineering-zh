import { type AgentEvent, runAgent } from './loop';
import { OpenAICompatibleModel } from './models/openai-compatible';
import { calculator, createReadNote, getTime } from './tools';

const SYSTEM = `你是一个办公助理。可以查时间、做计算、读用户的本地笔记。
- 需要事实时先用工具查，不要编造；算术一律用 calculator。
- 工具报错时读错误信息，修正参数再试；同一个错误最多重试一次，仍失败就如实告诉用户。
- 回答用简体中文，简洁直接。`;

const goal = process.argv.slice(2).join(' ').trim();
if (!goal) {
  console.error('用法：bun run src/main.ts "你的问题"');
  process.exit(1);
}

const controller = new AbortController();
process.on('SIGINT', () => controller.abort());

const print = (e: AgentEvent) => {
  if (e.type === 'model') {
    if (e.content) console.log(`\x1b[2m[第 ${e.step} 轮] ${e.content}\x1b[0m`);
    for (const c of e.toolCalls) console.log(`\x1b[36m→ ${c.name}(${JSON.stringify(c.args)})\x1b[0m`);
  } else {
    const color = e.isError ? '\x1b[31m' : '\x1b[32m';
    console.log(`${color}← ${e.content.slice(0, 200)}\x1b[0m`);
  }
};

const result = await runAgent(goal, {
  model: OpenAICompatibleModel.fromEnv(),
  tools: [getTime, calculator, createReadNote('notes')],
  system: SYSTEM,
  signal: controller.signal,
  onEvent: print,
});
console.log(`\n${result.text}`);
const u = result.usage;
console.log(`\x1b[2m（${result.steps} 轮；输入 ${u.inputTokens} tokens，其中缓存命中 ${u.cachedInputTokens}；输出 ${u.outputTokens}）\x1b[0m`);
