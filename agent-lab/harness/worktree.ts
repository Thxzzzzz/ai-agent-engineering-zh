import { appendFile, cp, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { sh, shOk } from './sh';
import { branchName, type CodingTask } from './task';

// worktree 放在仓库外，避免出现在仓库自己的 git status 里。
export function worktreePath(task: CodingTask): string {
  return join(homedir(), '.agent-lab', 'worktrees', basename(task.repo), task.id);
}

export async function createWorktree(task: CodingTask): Promise<string> {
  const path = worktreePath(task);
  if (await Bun.file(join(path, '.git')).exists()) return path; // 重跑时接着用
  await mkdir(join(path, '..'), { recursive: true });
  await shOk(['git', 'fetch', 'origin', task.base], task.repo);
  await shOk(['git', 'worktree', 'add', '-b', branchName(task), path, `origin/${task.base}`], task.repo);
  // 驾驭器自己的文件不进版本库：写进所有 worktree 共用的 info/exclude
  const common = resolve(path, await shOk(['git', 'rev-parse', '--git-common-dir'], path));
  await appendFile(join(common, 'info', 'exclude'), '\n/.harness/\n/.claude/settings.local.json\n');
  return path;
}

export type CleanupCheck = { ok: boolean; reasons: string[] };

// 删除前核对：有未提交改动或未推送的提交就不删，免得丢工作。
export async function checkRemovable(path: string): Promise<CleanupCheck> {
  const reasons: string[] = [];
  const status = await shOk(['git', 'status', '--porcelain'], path);
  if (status) reasons.push(`有未提交的改动：\n${status}`);
  // 不和 @{u} 比：从 origin/main 建出的分支会默认跟踪 origin/main，推送时没加 -u 就会误报。
  // 只看"有没有本地提交不在任何远端分支上"，推到哪个远端分支都算已推送。
  const unpushed = await shOk(['git', 'rev-list', '--count', 'HEAD', '--not', '--remotes'], path);
  if (Number(unpushed) > 0) reasons.push(`有 ${unpushed} 个提交没推送到任何远端分支`);
  return { ok: reasons.length === 0, reasons };
}

// 调用前必须先过 checkRemovable。剩下的只有驾驭器自己的被忽略文件（.harness/ 等），
// git 仍会因它们拒绝删除，所以先把 .harness/ 归档到运行记录目录，再强制删除。分支保留，PR 不受影响。
export async function removeWorktree(task: CodingTask): Promise<string> {
  const path = worktreePath(task);
  const archive = join(homedir(), '.agent-lab', 'runs', `${task.id}-${Date.now()}`);
  await mkdir(archive, { recursive: true });
  await cp(join(path, '.harness'), archive, { recursive: true });
  await shOk(['git', 'worktree', 'remove', '--force', path], task.repo);
  return archive;
}
