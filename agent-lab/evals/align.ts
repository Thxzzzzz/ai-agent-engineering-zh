// 判官对齐：拿人工标注检验 LLM 判官靠不靠谱。
// 用法：bun evals/align.ts evals/labels.jsonl evals/judged.jsonl
// 两个文件每行 { "key": "任务id#试验#失败模式", "verdict": "pass" | "fail" | "unknown" }，前者是人标的，后者是判官给的。
type Row = { key: string; verdict: 'pass' | 'fail' | 'unknown' };

export function alignment(human: Row[], judge: Row[]) {
  const j = new Map(judge.map((r) => [r.key, r.verdict]));
  let tp = 0; // 人判通过，判官也判通过
  let fn = 0; // 人判通过，判官判失败
  let tn = 0; // 人判失败，判官也判失败
  let fp = 0; // 人判失败，判官判通过（最危险：放过了真问题）
  let unknown = 0;
  let missing = 0;
  for (const h of human) {
    if (h.verdict === 'unknown') continue;
    const v = j.get(h.key);
    if (v === undefined) missing++;
    else if (v === 'unknown') unknown++;
    else if (h.verdict === 'pass') v === 'pass' ? tp++ : fn++;
    else v === 'fail' ? tn++ : fp++;
  }
  return {
    tpr: tp + fn ? tp / (tp + fn) : Number.NaN, // 真通过里被判通过的比例
    tnr: tn + fp ? tn / (tn + fp) : Number.NaN, // 真失败里被判失败的比例
    confusion: { tp, fn, tn, fp },
    unknown,
    missing,
  };
}

async function readRows(path: string): Promise<Row[]> {
  return (await Bun.file(path).text()).split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);
}

if (import.meta.main) {
  const [humanPath, judgePath] = process.argv.slice(2);
  if (!humanPath || !judgePath) throw new Error('用法：bun evals/align.ts <人工标注.jsonl> <判官结果.jsonl>');
  const r = alignment(await readRows(humanPath), await readRows(judgePath));
  console.log(`TPR（真通过被判通过）${(r.tpr * 100).toFixed(1)}%  TNR（真失败被判失败）${(r.tnr * 100).toFixed(1)}%`);
  console.log(`混淆：${JSON.stringify(r.confusion)}  判官无法判断 ${r.unknown}  缺少判官结果 ${r.missing}`);
  if (r.confusion.fp > 0) console.log('注意：有真失败被判官放过（fp），先读这些样本，补充失败模式的定义与例子。');
}
