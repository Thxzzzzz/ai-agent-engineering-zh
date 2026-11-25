import type { CodingTask } from './task';

// 每一轮都是全新的上下文，状态全靠仓库里的文件传递：功能清单、进度文件、git 历史。
export function sessionPrompt(task: CodingTask, session: number): string {
  return `你在为任务「${task.title}」工作，这是第 ${session} 轮。你的上下文是全新的，先按顺序做：
1. 运行 pwd，阅读 .harness/progress.md 和 git log --oneline -20，了解之前做到哪。
2. 阅读 .harness/features.json，选出一条 passes 为 false 的功能，这一轮只做这一条。
3. 实现它，并运行 ${task.verify.join(' ')} 验证；需要端到端检查的，按功能描述实际操作一遍，不要只看单元测试。
4. 确认通过后，把这一条的 passes 改为 true。features.json 里除 passes 外的任何内容都不许改、不许删条目。
5. 提交改动（一个功能一个提交），推送分支；还没有 PR 时用 gh pr create 开一个草稿 PR。
6. 在 .harness/progress.md 末尾追加：本轮做了什么、怎么验证的、下一轮该注意什么。
如果遇到无法独立决定的问题（需求有歧义、需要密钥、需要改与任务无关的代码），把问题写进 progress.md 的"待人决定"一节后停下，不要猜。`;
}

export function initialProgress(task: CodingTask): string {
  return `# ${task.title}\n\n任务 ID：${task.id}\n基线分支：${task.base}\n\n## 验收点\n${task.acceptance.map((a, i) => `- F${i + 1}：${a}`).join('\n')}\n\n## 待人决定\n\n（无）\n\n## 进度记录\n`;
}
