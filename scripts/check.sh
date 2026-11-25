#!/bin/bash
# 用法：scripts/check.sh <页面文件名...>   检查页面：JS 报错、骨架、390px 宽度下的横向溢出、站内链接。需要本机装有 Google Chrome（macOS 路径）。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cd "$ROOT" || exit 1
cat > _probe_$$.html <<'P'
<!doctype html><html><head><meta charset="utf-8"></head><body><iframe id="f" style="width:390px;height:800px;border:0"></iframe><pre id="o">PENDING</pre>
<script>
const f=document.getElementById('f');f.src=location.hash.slice(1);
f.onload=()=>setTimeout(()=>{const d=f.contentDocument;const w=d.documentElement.clientWidth;
const wide=[...d.querySelectorAll('body *')].filter(e=>!e.closest('pre')&&!e.closest('.table-wrap')&&!e.closest('.diagram')&&!e.closest('.sidebar')&&e.getBoundingClientRect().right>w+1).slice(0,6).map(e=>e.tagName+'.'+e.className);
const r={scroll:d.documentElement.scrollWidth,client:w,sidebar:!!d.querySelector('.sidebar'),anims:d.querySelectorAll('figure.anim').length,animBars:d.querySelectorAll('.anim-bar').length,quizzes:d.querySelectorAll('.quiz').length,widgets:d.querySelectorAll('.widget').length,h2:d.querySelectorAll('article h2').length,overflow:wide};
document.getElementById('o').textContent='RESULT '+JSON.stringify(r);},800);
</script></body></html>
P
for page in "$@"; do
  [ -f "$page" ] || { echo "$page: 文件不存在"; continue; }
  out=$("$CH" --headless=new --disable-gpu --allow-file-access-from-files --virtual-time-budget=4000 --enable-logging=stderr --v=0 --dump-dom "file://$ROOT/_probe_$$.html#$page" 2>"$ROOT/_err_$$.log" | grep -o 'RESULT {.*' | sed 's/<\/pre>.*//')
  errs=$(grep -E 'Uncaught|SyntaxError|TypeError|ReferenceError' "$ROOT/_err_$$.log" | sed 's/.*CONSOLE[^"]*"//' | head -5)
  # 站内链接
  bad=$(grep -oE 'href="[^"#:]+\.html' "$page" | sed 's/href="//' | sort -u | while read -r l; do [ -f "$l" ] || echo "$l"; done | tr '\n' ' ')
  echo "$page: $out"
  [ -n "$errs" ] && echo "  JS 错误: $errs"
  [ -n "$bad" ] && echo "  失效链接: $bad"
done
rm -f _probe_$$.html _err_$$.log
