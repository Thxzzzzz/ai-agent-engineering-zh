// 以 headless 方式启动编码 agent，并把它的事件流变成驾驭器能用的信息。
// 命令行参数与事件字段以各自的官方文档为准；解析器对不认识的事件只记录、不报错。
export type AgentKind = 'claude' | 'codex';

export function buildCommand(kind: AgentKind, prompt: string): string[] {
  if (kind === 'claude') {
    return [
      'claude', '-p', prompt,
      '--output-format', 'stream-json', '--verbose', // 逐行 JSON 事件；print 模式下流式输出需要 --verbose
      '--permission-mode', 'acceptEdits',            // 允许改文件；其余命令按下面的白名单放行
      '--allowedTools', 'Bash(bun test:*)', 'Bash(bun run:*)', 'Bash(git status:*)', 'Bash(git diff:*)',
      'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git push:*)', 'Bash(gh pr create:*)', 'Bash(gh pr view:*)',
    ];
  }
  // Codex：默认只读沙箱，workspace-write 允许写工作区；--json 输出 JSONL 事件
  return ['codex', 'exec', '--json', '--sandbox', 'workspace-write', prompt];
}

export type AgentEvent = {
  kind: 'init' | 'text' | 'tool' | 'result' | 'other';
  sessionId?: string;
  text?: string;
  tool?: string;
  costUsd?: number;
  isError?: boolean;
  raw: unknown;
};

type ContentBlock = { type?: string; text?: string; name?: string };

export function parseEventLine(line: string): AgentEvent | null {
  if (!line.trim()) return null;
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { kind: 'other', text: line, raw: line }; // 非 JSON 行（例如警告）原样记下
  }
  const sessionId = typeof e.session_id === 'string' ? e.session_id : undefined;
  if (e.type === 'system' && e.subtype === 'init') return { kind: 'init', sessionId, raw: e };
  if (e.type === 'assistant') {
    const blocks = ((e.message as { content?: ContentBlock[] } | undefined)?.content ?? []) as ContentBlock[];
    const tool = blocks.find((b) => b.type === 'tool_use');
    if (tool) return { kind: 'tool', tool: tool.name, sessionId, raw: e };
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return { kind: 'text', text, sessionId, raw: e };
  }
  if (e.type === 'result') {
    return {
      kind: 'result',
      sessionId,
      text: typeof e.result === 'string' ? e.result : undefined,
      costUsd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : undefined,
      isError: e.is_error === true || (typeof e.subtype === 'string' && e.subtype !== 'success'),
      raw: e,
    };
  }
  return { kind: 'other', raw: e };
}

export type SessionOutcome = { exitCode: number; sessionId: string | null; costUsd: number; finalText: string; tools: number };

export async function runSession(
  kind: AgentKind,
  cwd: string,
  prompt: string,
  onEvent: (e: AgentEvent) => void,
  timeoutMs = 45 * 60_000,
): Promise<SessionOutcome> {
  const proc = Bun.spawn(buildCommand(kind, prompt), { cwd, stdout: 'pipe', stderr: 'inherit', timeout: timeoutMs });
  const out: SessionOutcome = { exitCode: -1, sessionId: null, costUsd: 0, finalText: '', tools: 0 };
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const e = parseEventLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
      if (!e) continue;
      if (e.sessionId) out.sessionId = e.sessionId;
      if (e.kind === 'tool') out.tools++;
      if (e.kind === 'result') {
        out.costUsd = e.costUsd ?? 0;
        out.finalText = e.text ?? '';
      }
      onEvent(e);
    }
  }
  out.exitCode = await proc.exited;
  return out;
}
