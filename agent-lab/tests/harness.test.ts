import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCommand, parseEventLine } from '../harness/agent';
import { checkIntegrity, initFeatures, repair } from '../harness/features';
import { classifyChecks } from '../harness/progress';
import { decide } from '../harness/stop-hook';
import { CodingTaskSchema } from '../harness/task';

describe('功能清单', () => {
  const before = initFeatures(['导出支持按部门筛选', '筛选条件写进文件名']);
  // 拦：只改 passes 的合法更新被误判为越权
  test('只改 passes 不算违规', () => {
    const after = before.map((f) => ({ ...f, passes: f.id === 'F1' }));
    expect(checkIntegrity(before, after)).toEqual([]);
  });
  // 拦：agent 改写验收描述、删掉做不出来的条目来"完成"任务
  test('改描述、删条目都算违规，修复时只保留 passes', () => {
    const after = [{ id: 'F1', description: '导出支持筛选（部门筛选另行处理）', passes: true }];
    expect(checkIntegrity(before, after).length).toBeGreaterThanOrEqual(2);
    expect(repair(before, after)).toEqual([
      { id: 'F1', description: '导出支持按部门筛选', passes: true },
      { id: 'F2', description: '筛选条件写进文件名', passes: false },
    ]);
  });
});

describe('Stop hook', () => {
  // 拦：有未提交改动时放行，agent 宣布完成但改动没保存
  test('有未提交改动时阻止停止', () => {
    expect(decide({ stop_hook_active: false }, [' M src/export.ts']).code).toBe(2);
  });
  // 拦：每次都阻止，agent 永远停不下来
  test('已经续跑过一次就放行', () => {
    expect(decide({ stop_hook_active: true }, [' M src/export.ts']).code).toBe(0);
  });

  // 拦：脚本本身的 IO 写错（读不到 stdin、退出码不对）
  test('作为真实脚本运行时的退出码', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'hook-'));
    Bun.spawnSync(['git', 'init', '-q'], { cwd: repo });
    const run = (input: object) =>
      Bun.spawnSync(['bun', join(import.meta.dir, '..', 'harness', 'stop-hook.ts')], { stdin: Buffer.from(JSON.stringify(input)) });
    expect(run({ cwd: repo, stop_hook_active: false }).exitCode).toBe(0);
    await Bun.write(join(repo, 'a.txt'), 'x');
    const blocked = run({ cwd: repo, stop_hook_active: false });
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stderr.toString()).toContain('a.txt');
    expect(run({ cwd: repo, stop_hook_active: true }).exitCode).toBe(0);
  });
});

describe('CI 状态', () => {
  // 拦：有一个检查失败却报"通过"，或还在跑就报"通过"
  test('失败优先于进行中，进行中优先于成功', () => {
    expect(classifyChecks([])).toBe('none');
    expect(classifyChecks([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }, { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null }])).toBe('pending');
    expect(classifyChecks([{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null }, { __typename: 'StatusContext', state: 'FAILURE' }])).toBe('failure');
    expect(classifyChecks([{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' }, { __typename: 'StatusContext', state: 'SUCCESS' }])).toBe('success');
  });
});

describe('事件流解析', () => {
  // 拦：成本、会话 id 取不到，预算刹车形同虚设
  test('从结果事件里取出成本与会话', () => {
    const e = parseEventLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '完成 F1', session_id: 's1', total_cost_usd: 0.42 }));
    expect(e).toMatchObject({ kind: 'result', costUsd: 0.42, sessionId: 's1', isError: false });
  });
  // 拦：遇到不认识的事件或非 JSON 行就崩溃
  test('未知事件与非 JSON 行不报错', () => {
    expect(parseEventLine('{"type":"stream_event"}')?.kind).toBe('other');
    expect(parseEventLine('warning: something')?.kind).toBe('other');
    expect(parseEventLine('')).toBeNull();
  });
  test('识别工具调用', () => {
    const e = parseEventLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] } }));
    expect(e).toMatchObject({ kind: 'tool', tool: 'Edit' });
  });
  // 拦：提示词被拆成多个参数，或忘了要求逐行 JSON 输出
  test('提示词作为单个参数传入', () => {
    const cmd = buildCommand('claude', '做 F1；不要改 features 的描述');
    expect(cmd[cmd.indexOf('-p') + 1]).toBe('做 F1；不要改 features 的描述');
    expect(cmd).toContain('stream-json');
  });
});

describe('任务文件', () => {
  // 拦：任务 id 带空格或斜杠，拼进分支名和目录后出问题
  test('id 只允许安全字符，缺省值生效', () => {
    expect(CodingTaskSchema.safeParse({ id: 'Export Filter', title: 't', repo: '/r', acceptance: ['a'], verify: ['bun', 'test'] }).success).toBe(false);
    const ok = CodingTaskSchema.parse({ id: 'export-filter', title: 't', repo: '/r', acceptance: ['a'], verify: ['bun', 'test'] });
    expect(ok).toMatchObject({ base: 'main', agent: 'claude', maxSessions: 8 });
  });
});
