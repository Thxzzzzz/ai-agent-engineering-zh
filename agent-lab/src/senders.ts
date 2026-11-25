import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { Sender } from './outbox';

// 本地演示用：把"发出去的消息"追加到一个 JSONL 文件，按幂等键去重。
export class JsonlSender implements Sender {
  constructor(private readonly path = 'sent.jsonl') {}

  async send(msg: { idempotencyKey: string; target: string; body: string }) {
    const lines = existsSync(this.path) ? readFileSync(this.path, 'utf8').split('\n').filter(Boolean) : [];
    const found = lines.map((l) => JSON.parse(l) as { key: string; remoteId: string }).find((r) => r.key === msg.idempotencyKey);
    if (found) return { remoteId: found.remoteId };
    const remoteId = `local-${lines.length + 1}`;
    appendFileSync(this.path, `${JSON.stringify({ key: msg.idempotencyKey, remoteId, target: msg.target, body: msg.body, at: new Date().toISOString() })}\n`);
    return { remoteId };
  }
}

// 接真实服务：POST 到一个 webhook（自动化平台、内部网关等），幂等键放在 Idempotency-Key 头里。
export class WebhookSender implements Sender {
  constructor(private readonly url: string) {}

  async send(msg: { idempotencyKey: string; target: string; body: string }) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': msg.idempotencyKey },
      body: JSON.stringify({ target: msg.target, text: msg.body }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`webhook 返回 ${res.status}`);
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { remoteId: data.id ?? msg.idempotencyKey };
  }
}
