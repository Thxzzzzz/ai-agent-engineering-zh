import { describe, expect, test } from 'bun:test';
import { FakeMessageApi } from '../src/fake-message-api';
import { drainOutbox } from '../src/outbox';
import { decide, defaultPolicy } from '../src/policy';
import { approve, ConflictError, createProposal, getProposal, recoverInterrupted, reject, transition } from '../src/proposals';
import { openDb } from '../src/store/db';

const setup = () => {
  const db = openDb(':memory:');
  const p = createProposal(db, { kind: 'reply', target: '同事甲', body: '收到，下午给你。', confidence: 0.9, sourceRef: 't1' });
  return { db, p, api: new FakeMessageApi() };
};

describe('审批与发送', () => {
  test('同一条提案批准两次，只发出一条', async () => {
    const { db, p, api } = setup();
    approve(db, p.id);
    expect(() => approve(db, p.id)).toThrow(ConflictError);
    await drainOutbox(db, api);
    await drainOutbox(db, api);
    expect(api.delivered.length).toBe(1);
    expect(getProposal(db, p.id)!.status).toBe('done');
  });

  test('改写后批准，发出的是改写后的正文', async () => {
    const { db, p, api } = setup();
    approve(db, p.id, { editedBody: '收到，3 点前给你。' });
    await drainOutbox(db, api);
    expect(api.delivered[0]!.body).toBe('收到，3 点前给你。');
  });

  test('偶发失败会重试，重试成功只算一条', async () => {
    const { db, p, api } = setup();
    api.failNext = 2;
    approve(db, p.id);
    const r = await drainOutbox(db, api, { maxAttempts: 3 });
    expect(r).toEqual({ sent: 1, failed: 0 });
    expect(api.delivered.length).toBe(1);
  });

  test('"发出去了但响应丢了"：重试靠幂等键去重，对方只收到一条', async () => {
    const { db, p, api } = setup();
    api.loseResponseNext = 1;
    approve(db, p.id);
    await drainOutbox(db, api);
    expect(api.delivered.length).toBe(1);
    expect(getProposal(db, p.id)!.status).toBe('done');
  });

  test('重试用尽标为 failed，人再批准一次可以继续', async () => {
    const { db, p, api } = setup();
    api.failNext = 5;
    approve(db, p.id);
    expect(await drainOutbox(db, api, { maxAttempts: 2 })).toEqual({ sent: 0, failed: 1 });
    expect(getProposal(db, p.id)!.status).toBe('failed');
    api.failNext = 0;
    approve(db, p.id);
    await drainOutbox(db, api);
    expect(api.delivered.length).toBe(1);
  });

  test('进程在发送中崩溃：恢复后退回待审批，再批准不会重复发送', async () => {
    const { db, p, api } = setup();
    approve(db, p.id);
    // 模拟：对方已经收到，但我们还没来得及把状态写成 done 进程就退出了
    await api.send({ idempotencyKey: (db.query('SELECT idempotency_key k FROM outbox').get() as { k: string }).k, target: p.target, body: p.body });
    transition(db, p.id, ['approved'], 'executing');
    expect(recoverInterrupted(db)).toBe(1);
    expect(getProposal(db, p.id)!.status).toBe('pending');
    approve(db, p.id);
    await drainOutbox(db, api);
    expect(api.delivered.length).toBe(1);
  });

  test('拒绝后不能再批准', () => {
    const { db, p } = setup();
    reject(db, p.id, '语气太随意');
    expect(() => approve(db, p.id)).toThrow(ConflictError);
  });
});

describe('策略', () => {
  const at10 = new Date('2026-11-25T10:00:00');
  const auto = { ...defaultPolicy, modes: { 同事甲: 'auto' as const } };

  test('默认需要审批，哪怕置信度很高', () => {
    const { db } = setup();
    expect(decide(db, defaultPolicy, { target: '同事乙', body: '好的', confidence: 0.99, sourceText: '' }, at10).action).toBe('pending');
  });

  test('auto 对象命中敏感词时退回人工审批', () => {
    const { db } = setup();
    const d = decide(db, auto, { target: '同事甲', body: '好的', confidence: 0.95, sourceText: '合同今天能签吗' }, at10);
    expect(d.action).toBe('pending');
    expect(d.reasons.join()).toContain('合同');
  });

  test('auto 对象超过每小时上限后退回人工审批', () => {
    const { db } = setup();
    for (let i = 0; i < 3; i++) {
      const p = createProposal(db, { kind: 'reply', target: '同事甲', body: '收到', confidence: 0.95, sourceRef: `s${i}` }, at10.getTime());
      approve(db, p.id, { auto: true }, at10.getTime());
    }
    expect(decide(db, auto, { target: '同事甲', body: '收到', confidence: 0.95, sourceText: '' }, at10).action).toBe('pending');
  });
});
