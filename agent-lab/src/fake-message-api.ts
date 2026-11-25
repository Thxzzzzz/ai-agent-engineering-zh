import type { Sender } from './outbox';

// 模拟一个支持幂等键的外部消息服务：同一个键只投递一次，重复请求返回第一次的结果。
// 还能模拟两种故障：前 N 次直接失败；"其实发出去了，但响应在路上丢了"。
export class FakeMessageApi implements Sender {
  readonly delivered: { target: string; body: string; remoteId: string }[] = [];
  private readonly byKey = new Map<string, string>();
  failNext = 0;
  loseResponseNext = 0;

  async send(msg: { idempotencyKey: string; target: string; body: string }) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('503 Service Unavailable');
    }
    let remoteId = this.byKey.get(msg.idempotencyKey);
    if (!remoteId) {
      remoteId = `m${this.delivered.length + 1}`;
      this.byKey.set(msg.idempotencyKey, remoteId);
      this.delivered.push({ target: msg.target, body: msg.body, remoteId });
    }
    if (this.loseResponseNext > 0) {
      this.loseResponseNext--;
      throw new Error('连接超时（对方其实已经收到）');
    }
    return { remoteId };
  }
}
