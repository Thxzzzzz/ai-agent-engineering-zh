import { z } from 'zod';

// 一个开发任务：由人写好，驾驭器只负责执行与核对，不替人改需求。
export const CodingTaskSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,40}$/, '只用小写字母、数字和连字符，3–40 位'),
  title: z.string().min(1),
  repo: z.string().min(1).describe('仓库主目录的绝对路径'),
  base: z.string().default('main'),
  agent: z.enum(['claude', 'codex']).default('claude'),
  acceptance: z.array(z.string().min(1)).min(1).describe('验收点，每条一句可验证的话'),
  verify: z.array(z.string()).min(1).describe('独立复核用的命令，如 ["bun", "test"]'),
  maxSessions: z.number().int().min(1).max(30).default(8),
  maxCostUsd: z.number().positive().default(5),
});
export type CodingTask = z.infer<typeof CodingTaskSchema>;

export async function loadTask(path: string): Promise<CodingTask> {
  const parsed = CodingTaskSchema.safeParse(await Bun.file(path).json());
  if (!parsed.success) throw new Error(`任务文件 ${path} 不合法：\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export function branchName(task: CodingTask): string {
  return `agent/${task.id}`;
}
