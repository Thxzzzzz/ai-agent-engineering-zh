// 模型层的最小契约：整个 agent-lab 只依赖这几个类型，换厂商只换适配器。
export type ToolCall = { id: string; name: string; args: unknown };

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string; isError?: boolean };

export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type Usage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export type GenerateRequest = { messages: Message[]; tools: ToolSpec[]; signal?: AbortSignal };

export type GenerateResult = { content: string; toolCalls: ToolCall[]; usage: Usage; stopReason: StopReason };

export interface Model {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
});
