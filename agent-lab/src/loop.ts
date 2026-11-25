import { z } from 'zod';
import { addUsage, emptyUsage, type Message, type Model, type ToolCall, type Usage } from './model';
import { type Tool, toSpec } from './tools';

export type AgentEvent =
  | { type: 'model'; step: number; content: string; toolCalls: ToolCall[] }
  | { type: 'tool'; name: string; args: unknown; content: string; isError: boolean };

export type AgentOptions = {
  model: Model;
  tools: Tool[];
  system: string;
  maxSteps?: number;
  maxResultChars?: number;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
};

export type AgentResult = { text: string; messages: Message[]; steps: number; usage: Usage };

// 带上完整消息记录抛出，调用方能看到 agent 在哪一步、因为什么停下。
export class AgentError extends Error {
  constructor(message: string, readonly messages: Message[]) {
    super(message);
  }
}

export async function runAgent(goal: string, opts: AgentOptions): Promise<AgentResult> {
  const maxSteps = opts.maxSteps ?? 10;
  const tools = new Map(opts.tools.map((t) => [t.name, t]));
  const specs = opts.tools.map(toSpec);
  const messages: Message[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: goal },
  ];
  let usage = emptyUsage();

  for (let step = 1; step <= maxSteps; step++) {
    opts.signal?.throwIfAborted();
    const reply = await opts.model.generate({ messages, tools: specs, signal: opts.signal });
    usage = addUsage(usage, reply.usage);
    messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });
    opts.onEvent?.({ type: 'model', step, content: reply.content, toolCalls: reply.toolCalls });

    if (reply.stopReason === 'refusal') throw new AgentError('模型拒绝了这个请求', messages);
    if (reply.toolCalls.length === 0) {
      if (reply.stopReason === 'max_tokens') throw new AgentError('回答被截断（max_tokens）', messages);
      return { text: reply.content, messages, steps: step, usage };
    }
    // 每个 tool_call 都必须有一条对应的 tool 消息，否则下一次请求会被 API 拒绝
    for (const call of reply.toolCalls) {
      const result = await executeTool(tools, call, opts);
      messages.push({ role: 'tool', toolCallId: call.id, ...result });
      opts.onEvent?.({ type: 'tool', name: call.name, args: call.args, ...result });
    }
  }
  throw new AgentError(`超过最大步数 ${maxSteps} 仍未完成`, messages);
}

// 三类错误都不抛出，而是变成 isError 的结果回灌，让模型自己修正：工具不存在、参数不合法、执行失败。
async function executeTool(tools: Map<string, Tool>, call: ToolCall, opts: AgentOptions) {
  const tool = tools.get(call.name);
  if (!tool) {
    return { isError: true, content: `没有名为 ${call.name} 的工具。可用工具：${[...tools.keys()].join('、')}` };
  }
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) {
    return { isError: true, content: `参数不合法，请修正后重试：\n${z.prettifyError(parsed.error)}` };
  }
  try {
    const out = await tool.run(parsed.data, { signal: opts.signal });
    const max = opts.maxResultChars ?? 8000;
    return { isError: false, content: out.length > max ? `${out.slice(0, max)}\n…（已截断，共 ${out.length} 字）` : out };
  } catch (err) {
    if (opts.signal?.aborted) throw err; // 用户叫停不是工具错误，直接终止
    return { isError: true, content: `工具执行出错：${err instanceof Error ? err.message : String(err)}` };
  }
}
