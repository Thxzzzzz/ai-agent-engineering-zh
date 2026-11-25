import { OpenAICompatibleModel } from '../models/openai-compatible';
import type { Ticket } from './schema';
import { triageBatch } from './pipeline';

// 用法：bun run src/triage/main.ts tickets.json
const file = process.argv[2];
if (!file) {
  console.error('用法：bun run src/triage/main.ts <tickets.json>');
  process.exit(1);
}
const tickets = (await Bun.file(file).json()) as Ticket[];
const results = await triageBatch(OpenAICompatibleModel.fromEnv(), tickets, { concurrency: 4 });
for (const r of results) {
  if (!r.ok) {
    console.log(`✗ ${r.ticket.id} ${r.ticket.subject}\n  ${r.error}`);
    continue;
  }
  const a = r.analysis;
  console.log(`● ${r.ticket.id} [${a.category}/${a.urgency}] → ${r.route.queue} · ${r.route.action}  (${r.prompt}, ${r.attempts} 次)`);
  console.log(`  ${a.summary}`);
  for (const q of a.missing_info) console.log(`  ？${q}`);
  if (a.reply_draft) console.log(`  ✎ ${a.reply_draft}`);
}
