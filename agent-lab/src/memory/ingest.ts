import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import type { Model } from '../model';
import { completeStructured } from '../structured';
import { loadPrompt, render } from '../triage/prompt';
import { getMemory, insertMemory, invalidate, searchMemories } from './store';

export type ChatMessage = { id: string; from: string; text: string; at: number };

const Extracted = z.strictObject({
  facts: z.array(
    z.strictObject({
      subject: z.string(),
      content: z.string(),
      importance: z.number().int().min(1).max(10),
      source_message_id: z.string(),
    }),
  ),
});

const UpdateDecision = z.strictObject({
  op: z.enum(['ADD', 'UPDATE', 'INVALIDATE', 'NOOP']),
  target_id: z.string().nullable(),
  content: z.string().nullable(),
  reason: z.string(),
});

export type IngestLog = { fact: string; op: string; detail: string };

// 抽取 → 找相似 → 让模型选操作 → 代码校验后落库。每条事实独立处理，一条出错不影响其他。
export async function ingestConversation(db: Database, model: Model, messages: ChatMessage[], now = Date.now()): Promise<IngestLog[]> {
  const extractPrompt = await loadPrompt('memory-extract');
  const updatePrompt = await loadPrompt('memory-update');
  const transcript = messages.map((m) => `[${m.id}] ${m.from}：${m.text}`).join('\n');
  const { value } = await completeStructured(model, { schema: Extracted, system: render(extractPrompt, {}), user: transcript });

  const byId = new Map(messages.map((m) => [m.id, m]));
  const log: IngestLog[] = [];
  for (const fact of value.facts) {
    const source = byId.get(fact.source_message_id);
    // 模型给的 id 不可信：出处必须真的在这批消息里，否则这条"记忆"无从追溯
    if (!source) {
      log.push({ fact: fact.content, op: 'SKIP', detail: `出处 ${fact.source_message_id} 不在本批消息里` });
      continue;
    }
    const similar = searchMemories(db, fact.content, { subject: fact.subject, limit: 5 });
    const decision =
      similar.length === 0
        ? { op: 'ADD' as const, target_id: null, content: null, reason: '没有相似记忆' }
        : (
            await completeStructured(model, {
              schema: UpdateDecision,
              system: render(updatePrompt, {}),
              user: `新事实（subject=${fact.subject}）：${fact.content}\n\n已有记忆：\n${similar.map((m) => `- id=${m.id}：${m.content}`).join('\n')}`,
            })
          ).value;

    const base = { subject: fact.subject, source_message_id: fact.source_message_id, importance: fact.importance, origin: 'auto' as const, valid_from: source.at };
    if (decision.op === 'ADD') {
      const m = insertMemory(db, { ...base, content: fact.content }, now);
      log.push({ fact: fact.content, op: 'ADD', detail: m.id });
      continue;
    }
    const target = similar.find((m) => m.id === decision.target_id);
    if (!target) {
      log.push({ fact: fact.content, op: 'SKIP', detail: `模型指向的 ${decision.target_id} 不在候选里` });
      continue;
    }
    if (decision.op === 'NOOP') {
      log.push({ fact: fact.content, op: 'NOOP', detail: target.id });
      continue;
    }
    if (getMemory(db, target.id)?.origin === 'manual') {
      log.push({ fact: fact.content, op: 'SKIP', detail: '手写的记忆不被自动流程改动' });
      continue;
    }
    const content = decision.op === 'UPDATE' ? (decision.content ?? fact.content) : fact.content;
    db.transaction(() => {
      invalidate(db, target.id, source.at);
      insertMemory(db, { ...base, content, supersedes: target.id }, now);
    })();
    log.push({ fact: fact.content, op: decision.op, detail: `${target.id} → ${content}` });
  }
  return log;
}
