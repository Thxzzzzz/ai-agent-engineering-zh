import type { Model, Usage } from '../model';
import { completeStructured, StructuredOutputError } from '../structured';
import { loadPrompt, type Prompt, render } from './prompt';
import { type Ticket, TicketAnalysis } from './schema';

export type Route = { queue: 'engineering' | 'it' | 'product' | 'inbox'; action: 'escalate' | 'clarify' | 'reply' | 'archive' };

export type Triaged =
  | { ok: true; ticket: Ticket; analysis: TicketAnalysis; route: Route; prompt: string; usage: Usage; attempts: number }
  | { ok: false; ticket: Ticket; error: string; prompt: string };

// 路由是确定性代码：模型只负责分类，"分到哪、下一步做什么"由规则决定，可测、可审计。
export function route(a: TicketAnalysis): Route {
  const queue = a.category === 'bug' ? 'engineering' : a.category === 'access' ? 'it' : a.category === 'request' ? 'product' : 'inbox';
  if (a.urgency === 'critical') return { queue, action: 'escalate' };
  if (a.missing_info.length > 0) return { queue, action: 'clarify' };
  if (a.needs_reply) return { queue, action: 'reply' };
  return { queue, action: 'archive' };
}

const formatTicket = (t: Ticket) =>
  `<ticket id="${t.id}" channel="${t.channel}" from="${t.from}" received="${t.receivedAt}">\n主题：${t.subject}\n\n${t.body}\n</ticket>`;

export async function analyzeTicket(model: Model, ticket: Ticket, prompt: Prompt, today: string): Promise<Triaged> {
  const label = `${prompt.name}@${prompt.version}`;
  try {
    const r = await completeStructured(model, {
      schema: TicketAnalysis,
      system: render(prompt, { today }),
      user: formatTicket(ticket),
      toolDescription: '提交这张工单的分诊结果。',
    });
    return { ok: true, ticket, analysis: r.value, route: route(r.value), prompt: label, usage: r.usage, attempts: r.attempts };
  } catch (err) {
    if (!(err instanceof StructuredOutputError)) throw err; // 网络、鉴权这类错误交给上层统一处理
    return { ok: false, ticket, error: `${err.reason}: ${err.message}`, prompt: label };
  }
}

// 一批工单并发处理（限制并发数），单张失败不拖垮整批。
export async function triageBatch(model: Model, tickets: Ticket[], opts: { concurrency?: number; today?: string } = {}) {
  const prompt = await loadPrompt('triage');
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const results: Triaged[] = new Array(tickets.length);
  let next = 0;
  const worker = async () => {
    while (next < tickets.length) {
      const i = next++;
      results[i] = await analyzeTicket(model, tickets[i]!, prompt, today);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 4, tickets.length) }, worker));
  return results;
}
