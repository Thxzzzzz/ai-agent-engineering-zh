import { z } from 'zod';
import { addUsage, emptyUsage, type Message, type Model, type ToolSpec, type Usage } from './model';
import { toJsonSchema } from './tools';

export type StructuredRequest<S extends z.ZodType> = {
  schema: S;
  system: string;
  user: string;
  toolName?: string;
  toolDescription?: string;
  maxAttempts?: number;
  signal?: AbortSignal;
};

export type StructuredResult<T> = { value: T; usage: Usage; attempts: number };

export type StructuredFailure = 'refusal' | 'max_tokens' | 'invalid';

export class StructuredOutputError extends Error {
  constructor(message: string, readonly reason: StructuredFailure, readonly attempts: number, readonly usage: Usage) {
    super(message);
  }
}

// 结构化输出的统一入口：只给模型一个工具 emit_result，参数就是我们要的结构。
// 不合法就把校验错误回灌、让模型改，最多 maxAttempts 次；拒答和截断重试也没用，直接报错。
export async function completeStructured<S extends z.ZodType>(
  model: Model,
  req: StructuredRequest<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const toolName = req.toolName ?? 'emit_result';
  const maxAttempts = req.maxAttempts ?? 3;
  const tool: ToolSpec = {
    name: toolName,
    description: req.toolDescription ?? '提交最终结果。',
    inputSchema: toJsonSchema(req.schema),
  };
  const messages: Message[] = [
    { role: 'system', content: `${req.system}\n\n必须且只能通过调用 ${toolName} 工具提交结果，不要输出其他文字。` },
    { role: 'user', content: req.user },
  ];
  let usage = emptyUsage();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const reply = await model.generate({ messages, tools: [tool], signal: req.signal });
    usage = addUsage(usage, reply.usage);
    if (reply.stopReason === 'refusal') throw new StructuredOutputError('模型拒绝输出', 'refusal', attempt, usage);
    if (reply.stopReason === 'max_tokens') {
      throw new StructuredOutputError('输出被截断：调大 max_tokens，或让 schema 少要一些内容', 'max_tokens', attempt, usage);
    }
    messages.push({ role: 'assistant', content: reply.content, toolCalls: reply.toolCalls });

    const target = reply.toolCalls.find((c) => c.name === toolName);
    if (target) {
      const parsed = req.schema.safeParse(target.args);
      if (parsed.success) return { value: parsed.data, usage, attempts: attempt };
      for (const c of reply.toolCalls) {
        const content =
          c === target ? `结果不符合要求，请修正后重新调用 ${toolName}：\n${z.prettifyError(parsed.error)}` : `只能调用 ${toolName}`;
        messages.push({ role: 'tool', toolCallId: c.id, isError: true, content });
      }
    } else if (reply.toolCalls.length > 0) {
      for (const c of reply.toolCalls) messages.push({ role: 'tool', toolCallId: c.id, isError: true, content: `只能调用 ${toolName}` });
    } else {
      messages.push({ role: 'user', content: `你没有调用 ${toolName}。请调用它提交结果。` });
    }
  }
  throw new StructuredOutputError(`${maxAttempts} 次尝试后仍未得到合法结果`, 'invalid', maxAttempts, usage);
}
