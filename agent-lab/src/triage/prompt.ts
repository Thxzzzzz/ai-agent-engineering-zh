// 提示词放在 prompts/*.md，第一行 <!-- 名字@版本 --> 标明版本；每次调用都记下版本，评测和回溯时才对得上。
export type Prompt = { name: string; version: number; text: string };

export async function loadPrompt(name: string, dir = 'prompts'): Promise<Prompt> {
  const raw = await Bun.file(`${dir}/${name}.md`).text();
  const head = raw.match(/^<!--\s*([\w-]+)@(\d+)\s*-->\n/);
  if (!head || head[1] !== name) throw new Error(`${name}.md 第一行必须是 <!-- ${name}@版本号 -->`);
  return { name, version: Number(head[2]), text: raw.slice(head[0].length) };
}

// 变量替换。会变的内容（如日期）放在提示词末尾，前面不变的部分才能命中提示词缓存。
export function render(prompt: Prompt, vars: Record<string, string>): string {
  return prompt.text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`提示词 ${prompt.name} 缺少变量 ${key}`);
    return value;
  });
}
