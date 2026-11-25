import { z } from 'zod';

// 送进模型的原始工单。
export type Ticket = { id: string; from: string; channel: 'email' | 'chat' | 'form'; subject: string; body: string; receivedAt: string };

// 给模型填的结构。字段全部必填、不允许多余字段；"可以没有"用 nullable 表达，兼容各家 strict 模式。
export const TicketAnalysis = z.strictObject({
  summary: z.string().describe('一句话摘要，不超过 60 字'),
  category: z.enum(['bug', 'request', 'question', 'access', 'other']).describe('故障 / 需求 / 咨询 / 权限申请 / 其他'),
  urgency: z.enum(['low', 'normal', 'high', 'critical']).describe('critical 仅用于影响多人且无法绕过的问题'),
  needs_reply: z.boolean().describe('对方是否在等我们答复'),
  todos: z.array(
    z.strictObject({
      title: z.string().describe('动词开头的一句话'),
      owner: z.enum(['me', 'requester', 'unknown']),
      due: z.string().nullable().describe('YYYY-MM-DD；原文没提到期限就是 null，不要猜'),
    }),
  ),
  missing_info: z.array(z.string()).describe('推进这件事还缺的信息，每条写成可以直接发出去的问题；不缺就是空数组'),
  reply_draft: z.string().nullable().describe('needs_reply 为 true 时的回复草稿；否则为 null'),
  confidence: z.number().min(0).max(1).describe('你对以上判断整体的把握，0 到 1'),
});
export type TicketAnalysis = z.infer<typeof TicketAnalysis>;
