import { parseArgs } from 'node:util';
import { OpenAICompatibleModel } from './models/openai-compatible';
import { drainOutbox } from './outbox';
import { decide, defaultPolicy } from './policy';
import { approve, ConflictError, createProposal, expireStale, getProposal, listProposals, recoverInterrupted, reject, type Status } from './proposals';
import { JsonlSender, WebhookSender } from './senders';
import { openDb } from './store/db';
import type { Ticket } from './triage/schema';
import { triageBatch } from './triage/pipeline';

const HELP = `用法：bun run src/cli.ts <命令>
  triage <tickets.json>          分诊工单，需要回复的生成提案（按策略决定是否自动批准）
  list [--status pending]        列出提案
  show <id>                      查看一条提案
  approve <id> [--edit 新正文]    批准（可改写后批准）
  reject <id> --reason 理由       拒绝
  send                           把发件箱里排队的消息发出去
  expire                         作废过期的待审批提案`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { status: { type: 'string' }, edit: { type: 'string' }, reason: { type: 'string' } },
});
const [command, arg] = positionals;
const db = openDb(process.env.AGENT_LAB_DB ?? 'agent-lab.db');
const recovered = recoverInterrupted(db);
if (recovered) console.log(`⚠ 有 ${recovered} 条提案在上次发送时中断，已退回待审批`);
const sender = process.env.SEND_WEBHOOK_URL ? new WebhookSender(process.env.SEND_WEBHOOK_URL) : new JsonlSender();

try {
  switch (command) {
    case 'triage': {
      if (!arg) throw new Error('缺少 tickets.json');
      const tickets = (await Bun.file(arg).json()) as Ticket[];
      for (const r of await triageBatch(OpenAICompatibleModel.fromEnv(), tickets)) {
        if (!r.ok) {
          console.log(`✗ ${r.ticket.id} 分析失败：${r.error}`);
          continue;
        }
        const body = r.route.action === 'clarify' ? r.analysis.missing_info.join('\n') : r.analysis.reply_draft;
        if (!body || r.route.action === 'archive') continue;
        const d = decide(db, defaultPolicy, { target: r.ticket.from, body, confidence: r.analysis.confidence, sourceText: r.ticket.body });
        if (d.action === 'drop') continue;
        const p = createProposal(db, { kind: 'reply', target: r.ticket.from, body, confidence: r.analysis.confidence, sourceRef: r.ticket.id });
        if (d.action === 'auto') approve(db, p.id, { auto: true });
        console.log(`${d.action === 'auto' ? '⚡ 自动批准' : '• 待审批'} ${p.id} → ${p.target}（${d.reasons.join('；')}）`);
      }
      break;
    }
    case 'list':
      for (const p of listProposals(db, values.status as Status | undefined)) {
        console.log(`${p.id}  ${p.status.padEnd(9)} ${p.target}  ${(p.final_body ?? p.body).slice(0, 40).replace(/\n/g, ' ')}`);
      }
      break;
    case 'show':
      console.log(getProposal(db, arg ?? '') ?? '没有这条提案');
      break;
    case 'approve':
      approve(db, arg ?? '', { editedBody: values.edit });
      console.log(`已批准 ${arg}，执行 send 发出`);
      break;
    case 'reject':
      if (!values.reason) throw new Error('拒绝时请写 --reason，它是改进提示词最好的材料');
      reject(db, arg ?? '', values.reason);
      console.log(`已拒绝 ${arg}`);
      break;
    case 'send':
      console.log(await drainOutbox(db, sender));
      break;
    case 'expire':
      console.log(`作废 ${expireStale(db)} 条`);
      break;
    default:
      console.log(HELP);
  }
} catch (err) {
  console.error(err instanceof ConflictError ? `✗ ${err.message}` : err);
  process.exitCode = 1;
} finally {
  db.close();
}
