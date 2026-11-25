import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { defineTool, type Tool } from './tools';

export type McpServerConfig = {
  name: string;                       // 命名空间前缀，只允许字母数字和连字符
  command: string;
  args: string[];
  allowTools: string[];               // 允许暴露给模型的工具（server 端原名）
  pins: Record<string, string>;       // 工具原名 → 已批准的定义哈希
};

export const MAX_RESULT_CHARS = 6000;
export const MAX_DESCRIPTION_CHARS = 1024;

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

export class ToolPinError extends Error {}

export function hashToolDefinition(t: McpTool): string {
  const canonical = JSON.stringify({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema });
  return createHash('sha256').update(canonical).digest('hex');
}

export function truncateResult(text: string, max = MAX_RESULT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[结果已截断：原文 ${text.length} 字，只显示前 ${max} 字。请缩小时间范围或加关键词后重试]`;
}

type CallResult = { content?: unknown; structuredContent?: unknown; isError?: boolean };

export function resultToText(res: CallResult): { text: string; isError: boolean } {
  const blocks = Array.isArray(res.content) ? (res.content as Array<{ type: string; text?: string }>) : [];
  const parts = blocks.map((b) => (b.type === 'text' ? (b.text ?? '') : `[${b.type} 内容已省略]`));
  if (parts.length === 0 && res.structuredContent !== undefined) parts.push(JSON.stringify(res.structuredContent));
  return { text: truncateResult(parts.join('\n')), isError: res.isError === true };
}

export async function connectMcp(cfg: McpServerConfig): Promise<{ tools: Tool[]; close: () => Promise<void> }> {
  if (!/^[a-z0-9-]+$/.test(cfg.name)) throw new Error(`MCP 服务名只能用小写字母、数字和连字符：${cfg.name}`);
  // StdioClientTransport 默认只把一小组安全的环境变量传给子进程，不会泄露你的全部环境变量。
  const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args });
  const client = new Client({ name: 'agent-lab', version: '0.1.0' });
  await client.connect(transport);

  const discovered: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    discovered.push(...(page.tools as McpTool[]));
    cursor = page.nextCursor;
  } while (cursor);

  const tools: Tool[] = [];
  for (const name of cfg.allowTools) {
    const def = discovered.find((t) => t.name === name);
    if (!def) {
      await client.close();
      throw new Error(`MCP 服务 ${cfg.name} 没有提供允许列表中的工具 ${name}`);
    }
    const actual = hashToolDefinition(def);
    if (cfg.pins[name] !== actual) {
      await client.close();
      throw new ToolPinError(
        `工具 ${cfg.name}/${name} 的定义与已批准的不一致（期望 ${cfg.pins[name] ?? '未登记'}，实际 ${actual}）。` +
          '请审阅新的描述与 schema，确认无误后运行 bun src/mcp-client.ts --pin 更新 mcp-lock.json。',
      );
    }
    tools.push(toTool(cfg, client, def));
  }
  return { tools, close: () => client.close() };
}

function toTool(cfg: McpServerConfig, client: Client, def: McpTool): Tool {
  const description = (def.description ?? '').slice(0, MAX_DESCRIPTION_CHARS);
  return defineTool({
    name: `${cfg.name}__${def.name}`,
    description: `[来自 MCP 服务 ${cfg.name}] ${description}`,
    // 参数细节由 server 按自己的 inputSchema 校验，校验错误以 isError 返回；本地只保证是一个对象
    schema: z.record(z.string(), z.unknown()),
    jsonSchema: def.inputSchema,
    async run(args, { signal }) {
      const res = (await client.callTool({ name: def.name, arguments: args }, { signal })) as CallResult;
      const { text, isError } = resultToText(res);
      // 交给 P1 的循环：抛错 = 以 isError 的 tool_result 回灌，模型可以据此修正参数。
      if (isError) throw new Error(text);
      return text;
    },
  });
}

// 审阅工具定义后登记哈希：bun src/mcp-client.ts --pin
if (import.meta.main && process.argv.includes('--pin')) {
  const transport = new StdioClientTransport({ command: 'bun', args: ['mcp-server/index.ts'] });
  const client = new Client({ name: 'agent-lab-pin', version: '0.1.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const pins: Record<string, string> = {};
  for (const t of tools as McpTool[]) {
    console.log(`\n== ${t.name}\n${t.description ?? ''}\n${JSON.stringify(t.inputSchema, null, 2)}`);
    pins[t.name] = hashToolDefinition(t);
  }
  await Bun.write('mcp-lock.json', `${JSON.stringify({ calendar: pins }, null, 2)}\n`);
  console.log('\n已写入 mcp-lock.json。请确认上面的描述里没有可疑指令后再提交。');
  await client.close();
}
