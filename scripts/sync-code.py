# 用法：python3 scripts/sync-code.py . <页面...>
# 页面里 <pre data-title="相对路径"> 的代码块，若 agent-lab/相对路径 存在，就换成该文件的当前内容（转义后）。
import html, os, re, sys
root, pages = sys.argv[1], sys.argv[2:]
lab = os.path.join(root, 'agent-lab')
pat = re.compile(r'(<pre data-title="([^"]+)"><code class="lang-(\w+)">\n)(.*?)(\n</code></pre>)', re.S)
for page in pages:
    path = os.path.join(root, page)
    s = open(path, encoding='utf-8').read()
    changed, kept, missing = [], 0, []
    def rep(m):
        global kept
        title = m.group(2)
        f = os.path.join(lab, title)
        if not os.path.isfile(f):
            if '/' in title or title.endswith(('.ts', '.json', '.md', '.jsonl')):
                missing.append(title)
            return m.group(0)
        new = html.escape(open(f, encoding='utf-8').read().strip('\n'), quote=False)
        if new == m.group(4):
            return m.group(0)
        changed.append(title)
        return m.group(1) + new + m.group(5)
    s2 = pat.sub(rep, s)
    open(path, 'w', encoding='utf-8').write(s2)
    print(f'{page}: 更新 {len(changed)} {changed}  无对应文件 {missing}')
