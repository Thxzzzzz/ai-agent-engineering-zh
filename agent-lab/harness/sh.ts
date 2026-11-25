// 运行外部命令。所有 git / gh / agent 调用都经这里，统一拿到退出码与输出。
export type ShResult = { code: number; stdout: string; stderr: string };

export async function sh(cmd: string[], cwd: string, opts: { timeoutMs?: number } = {}): Promise<ShResult> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe', timeout: opts.timeoutMs ?? 120_000 });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function shOk(cmd: string[], cwd: string): Promise<string> {
  const r = await sh(cmd, cwd);
  if (r.code !== 0) throw new Error(`命令失败（${r.code}）：${cmd.join(' ')}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

// 需要人确认的步骤：要求输入指定的词，避免手滑回车就放行。
export function confirmByTyping(question: string, expected: string): boolean {
  const answer = prompt(`${question}\n确认请输入 ${expected}：`);
  return answer?.trim() === expected;
}
