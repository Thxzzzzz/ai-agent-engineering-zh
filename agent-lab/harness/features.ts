// 功能清单：把验收点展开成 JSON，agent 只允许改 passes 字段。
// 用 JSON 而不是 Markdown：模型更不容易随手改写 JSON 的结构和措辞。
export type Feature = { id: string; description: string; passes: boolean };

export function initFeatures(acceptance: string[]): Feature[] {
  return acceptance.map((description, i) => ({ id: `F${i + 1}`, description, passes: false }));
}

// 对比一轮前后的清单：除了 passes，任何改动（删条目、改描述、加条目）都算违规。
export function checkIntegrity(before: Feature[], after: unknown): string[] {
  if (!Array.isArray(after)) return ['features.json 不再是数组'];
  const violations: string[] = [];
  if (after.length !== before.length) violations.push(`条目数从 ${before.length} 变成了 ${after.length}`);
  before.forEach((b, i) => {
    const a = after[i] as Partial<Feature> | undefined;
    if (!a) return;
    if (a.id !== b.id) violations.push(`第 ${i + 1} 条的 id 被改成了 ${String(a.id)}`);
    if (a.description !== b.description) violations.push(`${b.id} 的描述被改动`);
    if (typeof a.passes !== 'boolean') violations.push(`${b.id} 的 passes 不是布尔值`);
    const extra = Object.keys(a).filter((k) => !['id', 'description', 'passes'].includes(k));
    if (extra.length) violations.push(`${b.id} 多了字段：${extra.join('、')}`);
  });
  return violations;
}

// 合法的那部分改动（passes）保留，其余恢复原样。
export function repair(before: Feature[], after: unknown): Feature[] {
  const list = Array.isArray(after) ? (after as Array<Partial<Feature>>) : [];
  return before.map((b) => {
    const a = list.find((x) => x?.id === b.id);
    return { ...b, passes: typeof a?.passes === 'boolean' ? a.passes : b.passes };
  });
}

export function allPass(features: Feature[]): boolean {
  return features.every((f) => f.passes);
}
