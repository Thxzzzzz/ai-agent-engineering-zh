// 去抖合批：同一个来源（同一个人、同一个会话）连续发来的几条，安静 quietMs 后或攒满 maxItems 条时合成一批处理。
// 人常常把一件事拆成好几条发，逐条分析既浪费又容易误判。
export class Batcher<T> {
  private readonly pending = new Map<string, { items: T[]; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly opts: { quietMs: number; maxItems: number },
    private readonly onFlush: (key: string, items: T[]) => void,
  ) {}

  add(key: string, item: T): void {
    const entry = this.pending.get(key);
    if (entry) clearTimeout(entry.timer);
    const items = entry ? [...entry.items, item] : [item];
    if (items.length >= this.opts.maxItems) {
      this.pending.delete(key);
      this.onFlush(key, items);
      return;
    }
    this.pending.set(key, { items, timer: setTimeout(() => this.flush(key), this.opts.quietMs) });
  }

  flush(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    this.onFlush(key, entry.items);
  }

  // 退出前调用，别把攒着的消息丢了
  flushAll(): void {
    for (const key of [...this.pending.keys()]) this.flush(key);
  }
}
