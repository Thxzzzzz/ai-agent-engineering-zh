import { OpenAICompatibleModel } from '../models/openai-compatible';
import { openDb } from '../store/db';
import { type ChatMessage, ingestConversation } from './ingest';
import { synthesizeProfile } from './profile';
import { retrieve } from './retrieve';

// 用法：
//   bun run src/memory/main.ts ingest chat.json     从一段对话里抽取并更新记忆
//   bun run src/memory/main.ts recall "月报导出谁负责"  检索并显示打分明细
//   bun run src/memory/main.ts profile 同事甲         综合一份人物档案
const [command, arg] = process.argv.slice(2);
const db = openDb(process.env.AGENT_LAB_DB ?? 'agent-lab.db');
if (command === 'ingest' && arg) {
  const messages = (await Bun.file(arg).json()) as ChatMessage[];
  for (const l of await ingestConversation(db, OpenAICompatibleModel.fromEnv(), messages)) console.log(`${l.op.padEnd(10)} ${l.fact}  (${l.detail})`);
} else if (command === 'recall' && arg) {
  for (const m of await retrieve(db, arg)) {
    const p = m.parts;
    console.log(`${m.score.toFixed(2)}  [近 ${p.recency.toFixed(2)} 重 ${p.importance.toFixed(2)} 相 ${p.relevance.toFixed(2)}]  ${m.subject}：${m.content}`);
  }
} else if (command === 'profile' && arg) {
  console.log(await synthesizeProfile(db, OpenAICompatibleModel.fromEnv(), arg));
} else {
  console.log('用法：ingest <chat.json> | recall <查询> | profile <对象>');
}
db.close();
