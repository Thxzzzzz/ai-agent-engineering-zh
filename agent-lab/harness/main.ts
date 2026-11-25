// 用法：bun harness/main.ts tasks/export-filter.json
import { appendFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runSession } from './agent';
import { allPass, checkIntegrity, type Feature, initFeatures, repair } from './features';
import { describe, snapshot } from './progress';
import { initialProgress, sessionPrompt } from './prompts';
import { confirmByTyping, sh } from './sh';
import { branchName, loadTask } from './task';
import { checkRemovable, createWorktree, removeWorktree, worktreePath } from './worktree';

const taskFile = process.argv[2];
if (!taskFile) throw new Error('用法：bun harness/main.ts <任务文件.json>');
const task = await loadTask(taskFile);

// ---- 1. 人确认后才启动 ----
console.log(`任务：${task.title}\n仓库：${task.repo}（基于 ${task.base}，新分支 ${branchName(task)}）`);
console.log(`工作目录：${worktreePath(task)}\n执行方：${task.agent}，最多 ${task.maxSessions} 轮，预算 $${task.maxCostUsd}`);
console.log(`验收点：\n${task.acceptance.map((a, i) => `  F${i + 1}. ${a}`).join('\n')}`);
if (!confirmByTyping('确认启动？', task.id)) process.exit(0);

// ---- 2. 隔离的工作目录与驾驭文件 ----
const wt = await createWorktree(task);
const dir = join(wt, '.harness');
await mkdir(dir, { recursive: true });
const featuresFile = Bun.file(join(dir, 'features.json'));
if (!(await featuresFile.exists())) {
  await Bun.write(featuresFile, `${JSON.stringify(initFeatures(task.acceptance), null, 2)}\n`);
  await Bun.write(join(dir, 'progress.md'), initialProgress(task));
}
if (task.agent === 'claude') {
  const hook = `bun ${resolve(import.meta.dir, 'stop-hook.ts')}`;
  await mkdir(join(wt, '.claude'), { recursive: true });
  await Bun.write(join(wt, '.claude', 'settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: hook }] }] } }, null, 2));
}
const events = join(dir, 'events.jsonl');
const record = (type: string, data: Record<string, unknown>) =>
  appendFile(events, `${JSON.stringify({ ts: new Date().toISOString(), type, ...data })}\n`);

// ---- 3. 逐轮推进：每轮一个全新上下文，只做一个功能 ----
let spent = 0;
let stalled = 0;
for (let session = 1; session <= task.maxSessions; session++) {
  const before = (await featuresFile.json()) as Feature[];
  if (allPass(before)) break;
  const commitsBefore = (await snapshot(wt, task.base)).commits.length;
  console.log(`\n== 第 ${session} 轮 ==`);
  const outcome = await runSession(task.agent, wt, sessionPrompt(task, session), (e) => {
    if (e.kind === 'tool') console.log(`  · ${e.tool}`);
    void record('agent', { session, kind: e.kind, tool: e.tool, text: e.text?.slice(0, 500) });
  });
  spent += outcome.costUsd;

  // 功能清单只许改 passes：越权的改动恢复，合法的保留
  const after: unknown = await featuresFile.json().catch(() => null);
  const violations = checkIntegrity(before, after);
  if (violations.length) {
    await Bun.write(featuresFile, `${JSON.stringify(repair(before, after), null, 2)}\n`);
    await record('violation', { session, violations });
    console.warn(`  ! 功能清单被越权修改，已恢复：${violations.join('；')}`);
  }
  const snap = await snapshot(wt, task.base);
  const features = (await featuresFile.json()) as Feature[];
  await record('session', { session, exitCode: outcome.exitCode, costUsd: outcome.costUsd, sessionId: outcome.sessionId, snapshot: snap });
  console.log(`  ${describe(snap)} · 功能 ${features.filter((f) => f.passes).length}/${features.length} · 累计 $${spent.toFixed(2)}`);

  // 刹车：超预算、连续两轮没有任何新提交
  if (spent >= task.maxCostUsd) {
    console.warn('已达预算上限，停止。');
    break;
  }
  stalled = snap.commits.length > commitsBefore ? 0 : stalled + 1;
  if (stalled >= 2) {
    console.warn('连续两轮没有新提交，停下等人看 .harness/progress.md 的"待人决定"。');
    break;
  }
}

// ---- 4. 独立复核：不采信 agent 的自述 ----
const features = (await featuresFile.json()) as Feature[];
const verify = await sh(task.verify, wt, { timeoutMs: 15 * 60_000 });
const snap = await snapshot(wt, task.base);
console.log('\n== 复核 ==');
for (const f of features) console.log(`  ${f.passes ? '✓' : '✗'} ${f.id} ${f.description}`);
console.log(`  复核命令 ${task.verify.join(' ')}：${verify.code === 0 ? '通过' : `失败（${verify.code}）`}`);
console.log(`  ${describe(snap)}`);
const done = allPass(features) && verify.code === 0 && snap.dirty.length === 0 && snap.ci !== 'failure';
await record('verify', { done, verifyCode: verify.code, snapshot: snap, spent });
console.log(done ? '\n结论：可以交给人评审 PR。' : '\n结论：还不能交付，见上面未通过的项。');

// ---- 5. 收尾清理（需确认，且有未保存的工作时拒绝） ----
if (done && confirmByTyping('删除工作目录？分支与 PR 保留。', 'remove')) {
  const check = await checkRemovable(wt);
  if (!check.ok) console.warn(`不删除：\n${check.reasons.join('\n')}`);
  else {
    const archive = await removeWorktree(task);
    console.log(`已删除工作目录；功能清单、进度与事件记录归档在 ${archive}`);
  }
}
