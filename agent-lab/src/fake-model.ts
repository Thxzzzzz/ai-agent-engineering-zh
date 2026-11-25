import type { GenerateRequest, GenerateResult, Model, ToolCall } from './model';

// 一步脚本：固定回复，或根据收到的请求现算回复（用来断言"模型这一轮看到了什么"）。
export type ScriptStep = Partial<GenerateResult> | ((req: GenerateRequest) => Partial<GenerateResult>);

// 离线测试用的假模型：按脚本依次返回回复，并记下每次收到的请求。
export class FakeModel implements Model {
  readonly requests: GenerateRequest[] = [];
  private cursor = 0;

  constructor(private readonly script: ScriptStep[]) {}

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    req.signal?.throwIfAborted();
    // 存快照：调用方之后还会往同一个数组里 push，不复制的话断言会看到"未来"的消息
    this.requests.push({ messages: structuredClone(req.messages), tools: structuredClone(req.tools) });
    const step = this.script[this.cursor++];
    if (!step) throw new Error(`FakeModel 脚本用完了：第 ${this.cursor} 次调用没有预设回复`);
    const r = typeof step === 'function' ? step(req) : step;
    const toolCalls = r.toolCalls ?? [];
    return {
      content: r.content ?? '',
      toolCalls,
      usage: r.usage ?? { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
      stopReason: r.stopReason ?? (toolCalls.length > 0 ? 'tool_use' : 'end'),
    };
  }
}

let seq = 0;
export const call = (name: string, args: unknown, id = `call_${++seq}`): ToolCall => ({ id, name, args });
