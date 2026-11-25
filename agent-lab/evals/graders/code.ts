import type { Assertion, Failure } from '../types';

// 按 "a.b.0.c" 取值；路径不存在返回 undefined。
export function getPath(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function show(v: unknown): string {
  return v === undefined ? '（缺失）' : JSON.stringify(v);
}

export function gradeAssertions(output: unknown, assertions: Assertion[]): Failure[] {
  const failures: Failure[] = [];
  for (const a of assertions) {
    const actual = getPath(output, a.path);
    const text = typeof actual === 'string' ? actual : JSON.stringify(actual ?? '');
    let ok: boolean;
    let want: string;
    if ('equals' in a) {
      ok = actual !== undefined && Bun.deepEquals(actual, a.equals);
      want = `等于 ${show(a.equals)}`;
    } else if ('oneOf' in a) {
      ok = a.oneOf.some((x) => Bun.deepEquals(actual, x));
      want = `属于 ${show(a.oneOf)}`;
    } else if ('includes' in a) {
      ok = actual !== undefined && text.includes(a.includes);
      want = `包含 "${a.includes}"`;
    } else if ('excludes' in a) {
      ok = actual !== undefined && !text.includes(a.excludes);
      want = `不包含 "${a.excludes}"`;
    } else {
      ok = actual !== undefined && new RegExp(a.matches).test(text);
      want = `匹配 /${a.matches}/`;
    }
    if (!ok) failures.push({ mode: `assert:${a.path}`, detail: `${a.path} 应${want}，实际 ${show(actual)}` });
  }
  return failures;
}
