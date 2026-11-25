import { resolve, sep } from 'node:path';
import { z } from 'zod';
import type { ToolSpec } from './model';

// 一个工具 = 给模型看的名字和说明 + 参数 schema + 真正执行的代码。
export type Tool<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: S;
  // 工具已经自带 JSON Schema（例如来自 MCP 服务）时直接交给模型；schema 仍负责本地校验
  jsonSchema?: Record<string, unknown>;
  run(args: z.infer<S>, ctx: { signal?: AbortSignal }): Promise<string>;
};

export const defineTool = <S extends z.ZodType>(tool: Tool<S>): Tool<S> => tool;

// zod → JSON Schema。去掉 $schema 键：有的兼容端点不认识它。
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

export const toSpec = (tool: Tool): ToolSpec => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.jsonSchema ?? toJsonSchema(tool.schema),
});

export const getTime = defineTool({
  name: 'get_time',
  description: '查询某个时区的当前日期和时间。需要知道"今天几号""现在几点"时调用。',
  schema: z.strictObject({ timezone: z.string().describe('IANA 时区名，例如 Asia/Shanghai、Europe/London') }),
  async run({ timezone }) {
    // 时区写错时 Intl 会抛 RangeError，由循环当成工具错误回灌给模型
    return new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, dateStyle: 'full', timeStyle: 'long' }).format(new Date());
  },
});

export const calculator = defineTool({
  name: 'calculator',
  description: '计算四则运算表达式，支持 + - * / 和括号。涉及任何算术都用它，不要心算。',
  schema: z.strictObject({ expression: z.string().describe('例如 (1200 - 300) * 1.06 / 12') }),
  async run({ expression }) {
    return String(evaluate(expression));
  },
});

// 递归下降求值：只认数字、运算符和括号。绝不用 eval —— 参数来自模型，等于来自不可信输入。
export function evaluate(input: string): number {
  const tokens = input.match(/\d+(?:\.\d+)?|[()+\-*/]|\S/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const primary = (): number => {
    const t = next();
    if (t === '(') {
      const v = expr();
      if (next() !== ')') throw new Error('缺少右括号');
      return v;
    }
    if (t === '-') return -primary();
    if (t !== undefined && /^\d/.test(t)) return Number(t);
    throw new Error(`无法识别的符号：${t ?? '（表达式结尾）'}`);
  };
  const term = (): number => {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = primary();
      if (op === '/' && r === 0) throw new Error('除数为 0');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
    return v;
  };
  const value = expr();
  if (pos < tokens.length) throw new Error(`多余的符号：${tokens[pos]}`);
  return value;
}

// 只能读 dir 目录下的笔记：解析成绝对路径后必须仍在目录内，挡住 ../ 和绝对路径。
export function createReadNote(dir: string) {
  const root = resolve(dir);
  return defineTool({
    name: 'read_note',
    description: '读取一篇本地笔记的全文。不知道文件名时，先传 "?" 列出所有笔记。',
    schema: z.strictObject({ name: z.string().describe('笔记文件名，例如 weekly.md；传 "?" 列出全部') }),
    async run({ name }) {
      const all = [...new Bun.Glob('*.md').scanSync(root)].sort();
      if (name === '?') return all.length ? all.join('\n') : '（没有笔记）';
      const path = resolve(root, name);
      if (!path.startsWith(root + sep)) throw new Error('只能读取笔记目录里的文件');
      const file = Bun.file(path);
      if (!(await file.exists())) throw new Error(`没有 ${name}。现有笔记：${all.join('、') || '无'}`);
      return file.text();
    },
  });
}
