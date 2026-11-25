// Claude Code 的 Stop hook：agent 想停下时运行。
// 有未提交改动 → 退出码 2，stderr 的内容会交回给 agent，它会继续干活；只提醒一次。
// 注意：退出码 1 不会阻止停止，只有 2 才会。
export type HookInput = { stop_hook_active?: boolean; cwd?: string };

export function decide(input: HookInput, dirtyFiles: string[]): { code: 0 | 2; message: string } {
  // 已经因为 Stop hook 继续过一次了：放行，避免无限循环
  if (input.stop_hook_active) return { code: 0, message: '' };
  if (dirtyFiles.length === 0) return { code: 0, message: '' };
  return {
    code: 2,
    message: [
      `停下之前还有 ${dirtyFiles.length} 个文件的改动没有提交：`,
      ...dirtyFiles.slice(0, 20),
      '请确认这些改动是否属于本次功能：属于就运行测试后提交，并更新 .harness/progress.md；不属于就还原。',
    ].join('\n'),
  };
}

if (import.meta.main) {
  const input = JSON.parse(await Bun.stdin.text()) as HookInput;
  const proc = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: input.cwd ?? process.cwd() });
  const dirty = proc.stdout.toString().split('\n').filter((l) => l.trim() && !l.includes('.harness/'));
  const { code, message } = decide(input, dirty);
  if (message) console.error(message);
  process.exit(code);
}
