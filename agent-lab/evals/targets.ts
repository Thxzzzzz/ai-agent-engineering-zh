import { z } from 'zod';
import { runAgent } from '../src/loop';
import type { Model } from '../src/model';
import { defineTool, type Tool } from '../src/tools';
import { analyzeTicket } from '../src/triage/pipeline';
import { loadPrompt } from '../src/triage/prompt';
import type { Ticket } from '../src/triage/schema';
import type { Target } from './types';

// P2 的分诊管线：输入是一张工单，输出是分诊结果加上路由。
// 日期固定下来，避免"今天"不同导致同一任务的期限判断漂移；提示词只加载一次，版本写进轨迹。
export function triageTarget(model: Model, today = '2026-11-30'): Target {
  const prompt = loadPrompt('triage');
  return async (input) => {
    const r = await analyzeTicket(model, input as Ticket, await prompt, today);
    if (!r.ok) throw new Error(r.error); // 结构化输出失败：记为这次试验出错
    const output = { ...r.analysis, route: r.route };
    return { output, transcript: `prompt=${r.prompt} attempts=${r.attempts}\n${JSON.stringify(output)}` };
  };
}

// P1 的 agent：每次试验都新建一份待办清单，试验之间互不影响（干净环境）。
// 评的是最终状态（清单里有什么）和回答，而不是它调用工具的路径。
export function createTodoEnv(seed: string[] = []) {
  const todos = seed.map((title, i) => ({ id: i + 1, title, done: false }));
  let nextId = todos.length + 1;
  const tools: Tool[] = [
    defineTool({
      name: 'list_todos',
      description: '列出全部待办，返回 JSON 数组。',
      schema: z.strictObject({}),
      run: async () => JSON.stringify(todos),
    }),
    defineTool({
      name: 'add_todo',
      description: '新增一条待办。标题不超过 50 字；已存在同名待办时返回错误。',
      schema: z.strictObject({ title: z.string().trim().min(1).max(50).describe('待办标题') }),
      run: async ({ title }) => {
        if (todos.some((t) => t.title === title)) throw new Error(`已存在同名待办：${title}`);
        todos.push({ id: nextId++, title, done: false });
        return `已添加 #${nextId - 1}`;
      },
    }),
    defineTool({
      name: 'complete_todo',
      description: '把指定 id 的待办标记为完成。',
      schema: z.strictObject({ id: z.number().int() }),
      run: async ({ id }) => {
        const t = todos.find((x) => x.id === id);
        if (!t) throw new Error('没有这个 id 的待办，请先 list_todos');
        t.done = true;
        return `已完成 #${t.id}`;
      },
    }),
  ];
  return { tools, state: () => ({ todos: structuredClone(todos) }) };
}

export function agentTarget(model: Model): Target {
  return async (input) => {
    const { prompt, seed } = input as { prompt: string; seed: string[] };
    const env = createTodoEnv(seed);
    const result = await runAgent(prompt, { model, tools: env.tools, system: '你是待办助手，只能通过工具读写待办。', maxSteps: 8 });
    const transcript = result.messages
      .map((m) =>
        m.role === 'assistant'
          ? `assistant: ${m.content} ${JSON.stringify(m.toolCalls)}`
          : m.role === 'tool'
            ? `tool${m.isError ? '(错误)' : ''}: ${m.content}`
            : `${m.role}: ${m.content}`,
      )
      .join('\n');
    return { output: { answer: result.text, ...env.state() }, transcript };
  };
}
