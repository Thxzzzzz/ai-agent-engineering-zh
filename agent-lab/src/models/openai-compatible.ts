import type { GenerateRequest, GenerateResult, Message, Model, StopReason, ToolCall } from '../model';

// OpenAI Chat Completions 兼容接口的适配器：多数模型厂商与本地推理服务都提供这套接口。
// 只用 fetch，不引 SDK，好让你看清线上传的到底是什么。
export type OpenAICompatibleOptions = { baseURL: string; apiKey?: string; model: string; maxTokens?: number };

type WireToolCall = { id: string; type: string; function?: { name: string; arguments: string } };
type WireResponse = {
  choices: { finish_reason: string | null; message: { content: string | null; refusal?: string | null; tool_calls?: WireToolCall[] } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
};

export class OpenAICompatibleModel implements Model {
  constructor(private readonly opts: OpenAICompatibleOptions) {}

  // Bun 会自动读取项目根目录的 .env
  static fromEnv(): OpenAICompatibleModel {
    const model = process.env.LLM_MODEL;
    if (!model) throw new Error('请设置 LLM_MODEL（以及 LLM_BASE_URL、LLM_API_KEY），见 .env.example');
    return new OpenAICompatibleModel({
      baseURL: process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
      apiKey: process.env.LLM_API_KEY,
      model,
    });
  }

  async generate({ messages, tools, signal }: GenerateRequest): Promise<GenerateResult> {
    const body = {
      model: this.opts.model,
      messages: messages.map(toWire),
      ...(this.opts.maxTokens ? { max_tokens: this.opts.maxTokens } : {}),
      ...(tools.length > 0
        ? { tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) }
        : {}),
    };
    const res = await fetch(`${this.opts.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) throw new Error(`模型接口返回 ${res.status}：${(await res.text()).slice(0, 500)}`);
    const data = (await res.json()) as WireResponse;
    const choice = data.choices[0];
    if (!choice) throw new Error('模型接口没有返回 choices');

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? [])
      .filter((c) => c.type === 'function' && c.function)
      .map((c) => ({ id: c.id, name: c.function!.name, args: parseArgs(c.function!.arguments) }));
    return {
      content: choice.message.content ?? choice.message.refusal ?? '',
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        cachedInputTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      },
      stopReason: stopReasonOf(choice.finish_reason, choice.message.refusal),
    };
  }
}

function toWire(m: Message) {
  switch (m.role) {
    case 'system':
    case 'user':
      return { role: m.role, content: m.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls.length > 0
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.isError ? `[错误] ${m.content}` : m.content };
  }
}

// 模型生成的 arguments 是字符串，不保证是合法 JSON。解析失败就原样交出去，由参数校验报错回灌。
function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function stopReasonOf(finish: string | null, refusal?: string | null): StopReason {
  if (refusal) return 'refusal';
  if (finish === 'tool_calls') return 'tool_use';
  if (finish === 'length') return 'max_tokens';
  if (finish === 'content_filter') return 'refusal';
  return 'end';
}
