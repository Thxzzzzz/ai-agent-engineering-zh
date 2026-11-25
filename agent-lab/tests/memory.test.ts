import { describe, expect, test } from 'bun:test';
import { call, FakeModel } from '../src/fake-model';
import { type ChatMessage, ingestConversation } from '../src/memory/ingest';
import { approveProfileUpdate, getProfile, reflect } from '../src/memory/profile';
import { retrieve } from '../src/memory/retrieve';
import { forget, insertMemory, validMemories } from '../src/memory/store';
import { approve, createProposal, getProposal, reject } from '../src/proposals';
import { openDb } from '../src/store/db';

const HOUR = 3600_000;
const T0 = Date.parse('2026-11-01T09:00:00Z');
const emit = (args: unknown) => ({ toolCalls: [call('emit_result', args)] });
const msgs: ChatMessage[] = [{ id: 'm1', from: '同事甲', text: '月报导出以后归我管了，之前是同事乙', at: T0 }];

describe('写入记忆', () => {
  test('情况变了：旧事实失效而不是删除，新事实指向它', async () => {
    const db = openDb(':memory:');
    const old = insertMemory(db, { subject: '月报导出', content: '月报导出模块由同事乙负责', source_message_id: 'm0', importance: 7, origin: 'auto' }, T0 - 30 * 24 * HOUR);
    const model = new FakeModel([
      emit({ facts: [{ subject: '月报导出', content: '月报导出模块由同事甲负责', importance: 7, source_message_id: 'm1' }] }),
      emit({ op: 'INVALIDATE', target_id: old.id, content: null, reason: '负责人变了' }),
    ]);
    const log = await ingestConversation(db, model, msgs, T0);
    expect(log[0]!.op).toBe('INVALIDATE');
    const valid = validMemories(db, '月报导出');
    expect(valid.map((m) => m.content)).toEqual(['月报导出模块由同事甲负责']);
    expect(valid[0]!.supersedes).toBe(old.id);
    // 拦：直接删除旧记忆，"以前是谁负责"再也答不上来
    expect(db.query('SELECT valid_to FROM memories WHERE id = ?').get(old.id)).toEqual({ valid_to: T0 });
  });

  test('模型编造的出处与目标 id 一律不落库', async () => {
    const db = openDb(':memory:');
    insertMemory(db, { subject: '月报导出', content: '月报导出模块由同事乙负责', source_message_id: 'm0', importance: 7, origin: 'auto' });
    const model = new FakeModel([
      emit({
        facts: [
          { subject: '月报导出', content: '月报导出模块由同事甲负责', importance: 7, source_message_id: 'm1' },
          { subject: '同事甲', content: '同事甲下周休假', importance: 5, source_message_id: 'm99' },
        ],
      }),
      emit({ op: 'UPDATE', target_id: 'not-a-real-id', content: '……', reason: '' }),
    ]);
    const log = await ingestConversation(db, model, msgs, T0);
    expect(log.map((l) => l.op)).toEqual(['SKIP', 'SKIP']);
    expect(validMemories(db, '同事甲')).toEqual([]);
  });

  test('手写的记忆不会被自动流程改掉', async () => {
    const db = openDb(':memory:');
    const manual = insertMemory(db, { subject: '月报导出', content: '月报导出模块由同事乙负责', source_message_id: 'manual', importance: 9, origin: 'manual' });
    const model = new FakeModel([
      emit({ facts: [{ subject: '月报导出', content: '月报导出模块由同事甲负责', importance: 7, source_message_id: 'm1' }] }),
      emit({ op: 'INVALIDATE', target_id: manual.id, content: null, reason: '' }),
    ]);
    await ingestConversation(db, model, msgs, T0);
    expect(validMemories(db, '月报导出').map((m) => m.id)).toEqual([manual.id]);
  });
});

describe('检索打分', () => {
  test('相关性相同时，重要且最近用过的排在前面', async () => {
    const db = openDb(':memory:');
    const now = T0 + 10 * 24 * HOUR;
    insertMemory(db, { subject: '同事甲', content: '同事甲负责月报导出', source_message_id: 'a', importance: 3, origin: 'auto' }, T0);
    const fresh = insertMemory(db, { subject: '同事甲', content: '同事甲负责月报导出的筛选功能', source_message_id: 'b', importance: 8, origin: 'auto' }, now - HOUR);
    const top = await retrieve(db, '月报导出谁负责', { now, weights: { recency: 1, importance: 1, relevance: 0 } });
    expect(top[0]!.id).toBe(fresh.id);
  });

  test('失效的记忆不会被检索到', async () => {
    const db = openDb(':memory:');
    const m = insertMemory(db, { subject: '同事乙', content: '同事乙负责月报导出', source_message_id: 'a', importance: 9, origin: 'auto' });
    db.query('UPDATE memories SET valid_to = ? WHERE id = ?').run(Date.now(), m.id);
    expect(await retrieve(db, '月报导出')).toEqual([]);
  });

  test('可以插入向量模型替换关键词相关性', async () => {
    const db = openDb(':memory:');
    const a = insertMemory(db, { subject: 'x', content: '月报导出按部门筛选', source_message_id: 'a', importance: 5, origin: 'auto' });
    insertMemory(db, { subject: 'x', content: '月报导出的周会时间', source_message_id: 'b', importance: 5, origin: 'auto' });
    const embedder = { embed: async (texts: string[]) => texts.map((t) => [t.includes('筛选') || t.includes('部门') ? 1 : 0, 1]) };
    const top = await retrieve(db, '月报导出按部门', { embedder, weights: { recency: 0, importance: 0, relevance: 1 } });
    expect(top[0]!.id).toBe(a.id);
  });
});

describe('档案与反思', () => {
  test('反思生成待审批提案；批准后才写进档案', async () => {
    const db = openDb(':memory:');
    for (const [i, reason] of ['太长了', '他只看结论', '先说结论'].entries()) {
      const p = createProposal(db, { kind: 'reply', target: '同事甲', body: `草稿${i}`, confidence: 0.8, sourceRef: `s${i}` });
      reject(db, p.id, reason);
    }
    const model = new FakeModel([emit({ changes: [{ field: 'communication', new_value: '先给结论和时间点，细节放后面', evidence: '三次因冗长被拒' }] })]);
    const [id] = await reflect(db, model, '同事甲');
    expect(getProposal(db, id!)!.status).toBe('pending');
    expect(getProfile(db, '同事甲')).toBeNull(); // 拦：反思直接改档案，跳过了人的审批
    approveProfileUpdate(db, id!);
    expect(getProfile(db, '同事甲')!.profile.communication).toBe('先给结论和时间点，细节放后面');
  });

  test('档案在提案生成后被人改过：拒绝覆盖', async () => {
    const db = openDb(':memory:');
    db.query("INSERT INTO profiles (subject, profile, updated_at) VALUES ('同事甲', ?, 0)").run(
      JSON.stringify({ role: null, responsibilities: [], communication: '先说结论', working_notes: [] }),
    );
    const body = JSON.stringify({ field: 'communication', before: '原来的写法', after: '新写法', evidence: '' });
    const p = createProposal(db, { kind: 'profile_update', target: '同事甲', body, confidence: 0.5, sourceRef: 'reflect' });
    approveProfileUpdate(db, p.id);
    expect(getProposal(db, p.id)!.status).toBe('failed');
    expect(getProfile(db, '同事甲')!.profile.communication).toBe('先说结论');
  });

  test('档案修改提案不会进发件箱', () => {
    const db = openDb(':memory:');
    const p = createProposal(db, { kind: 'profile_update', target: '同事甲', body: '{}', confidence: 0.5, sourceRef: 'reflect' });
    approve(db, p.id);
    expect(db.query('SELECT COUNT(*) n FROM outbox').get()).toEqual({ n: 0 });
  });

  test('忘掉一个人：记忆、索引、档案全部删除', async () => {
    const db = openDb(':memory:');
    insertMemory(db, { subject: '同事甲', content: '同事甲负责月报导出', source_message_id: 'a', importance: 5, origin: 'auto' });
    expect(forget(db, '同事甲')).toBe(1);
    expect(await retrieve(db, '月报导出')).toEqual([]);
    expect(db.query('SELECT COUNT(*) n FROM memories_fts').get()).toEqual({ n: 0 });
  });
});
