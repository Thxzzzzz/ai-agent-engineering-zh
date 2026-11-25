// AI Agent 工程课程：全站共用的页面骨架与交互组件。
// 页面约定：<body data-page="ch01">，正文写在 <article id="content"> 里；本脚本负责侧边栏、目录、页脚、
// 代码高亮，以及 .anim（分步动画）、.tabs、.quiz、.checklist 等组件。页面专属的交互写在各页自己的 <script> 里，
// 用 Course.ready(fn) 等骨架建好后再执行。
(function () {
  'use strict';

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('aec:' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('aec:' + key, JSON.stringify(value));
      } catch (_) {
        /* 隐私模式等情况下存不了，页面照常工作 */
      }
    },
  };

  const readyQueue = [];
  let isReady = false;
  const Course = {
    store,
    ready(fn) {
      if (isReady) fn();
      else readyQueue.push(fn);
    },
    el(tag, attrs, children) {
      const node = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) {
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
      for (const c of [].concat(children || [])) node.append(c);
      return node;
    },
    escape(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    },
  };
  window.Course = Course;

  const flat = () => (window.COURSE ? window.COURSE.parts.flatMap((p) => p.items) : []);
  const isDone = (id) => store.get('done:' + id, false);
  const countable = () => flat().filter((i) => i.minutes !== undefined);

  // ---------- 骨架 ----------
  function buildLayout() {
    const article = document.getElementById('content');
    if (!article || !window.COURSE) return;
    const pageId = document.body.dataset.page;

    const sidebar = Course.el('aside', { class: 'sidebar', 'aria-label': '课程目录' });
    sidebar.append(
      Course.el('a', { class: 'brand', href: 'index.html' }, [
        Course.el('b', { text: window.COURSE.title }),
        Course.el('span', { text: window.COURSE.subtitle }),
      ]),
      Course.el('div', { class: 'progress-mini', title: '学习进度' }, [Course.el('i')]),
    );
    for (const part of window.COURSE.parts) {
      const box = Course.el('div', { class: 'nav-part' }, [Course.el('div', { text: part.name })]);
      for (const item of part.items) {
        const a = Course.el('a', { href: item.file, 'data-id': item.id }, [
          Course.el('span', { class: 'dot', text: isDone(item.id) ? '✓' : '·' }),
          Course.el('span', { text: item.short || item.title }),
        ]);
        if (item.id === pageId) a.classList.add('active');
        if (isDone(item.id)) a.classList.add('done');
        box.append(a);
      }
      sidebar.append(box);
    }
    const themeBtn = Course.el('button', { class: 'btn small', type: 'button', text: '切换明暗', onclick: toggleTheme });
    sidebar.append(Course.el('div', { class: 'sidebar-tools' }, [themeBtn]));

    const topbar = Course.el('div', { class: 'topbar' }, [
      Course.el('button', {
        class: 'btn small',
        type: 'button',
        text: '☰ 目录',
        'aria-label': '打开课程目录',
        onclick: (e) => {
          e.stopPropagation();
          document.body.classList.toggle('nav-open');
        },
      }),
      Course.el('b', { text: window.COURSE.title }),
    ]);
    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('nav-open') && !sidebar.contains(e.target)) {
        document.body.classList.remove('nav-open');
      }
    });

    const toc = Course.el('nav', { class: 'toc', 'aria-label': '本页目录' });
    const main = Course.el('main', { class: 'main' });
    const right = Course.el('div', {}, [topbar, main]);
    const layout = Course.el('div', { class: 'layout' }, [sidebar, right]);
    article.replaceWith(layout);
    main.append(article, toc);

    if (pageId && pageId !== 'index') article.append(buildChapterEnd(pageId));
    buildToc(article, toc);
    updateProgress();
    const active = sidebar.querySelector('a.active');
    // 只滚动侧边栏自身，scrollIntoView 会连带滚动整页
    if (active) sidebar.scrollTop = active.offsetTop - sidebar.clientHeight / 2;
  }

  function toggleTheme() {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    store.set('theme', next);
    try {
      localStorage.setItem('aec:theme', next);
    } catch (_) {}
  }

  function buildChapterEnd(pageId) {
    const items = flat();
    const idx = items.findIndex((i) => i.id === pageId);
    const end = Course.el('section', { class: 'chapter-end' });
    const item = items[idx];
    if (item && item.minutes !== undefined) {
      const btn = Course.el('button', { class: 'btn primary', type: 'button' });
      const sync = () => {
        btn.textContent = isDone(pageId) ? '✓ 已完成（点此取消）' : '标记本页为已完成';
        btn.classList.toggle('primary', !isDone(pageId));
      };
      btn.addEventListener('click', () => {
        store.set('done:' + pageId, !isDone(pageId));
        sync();
        updateProgress();
        const link = document.querySelector(`.sidebar a[data-id="${pageId}"]`);
        if (link) {
          link.classList.toggle('done', isDone(pageId));
          link.querySelector('.dot').textContent = isDone(pageId) ? '✓' : '·';
        }
      });
      sync();
      end.append(Course.el('div', { class: 'done-row' }, [btn, Course.el('span', { class: 'pill', text: '进度只保存在你的浏览器里' })]));
    }
    const pager = Course.el('div', { class: 'pager' });
    const prev = items[idx - 1];
    const next = items[idx + 1];
    if (prev) pager.append(Course.el('a', { href: prev.file, class: 'prev' }, [Course.el('small', { text: '← 上一页' }), document.createTextNode(prev.title)]));
    if (next) pager.append(Course.el('a', { href: next.file, class: 'next' }, [Course.el('small', { text: '下一页 →' }), document.createTextNode(next.title)]));
    end.append(pager);
    return end;
  }

  function updateProgress() {
    const all = countable();
    const done = all.filter((i) => isDone(i.id)).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;
    document.querySelectorAll('.progress-mini i, [data-progress-bar]').forEach((b) => (b.style.width = pct + '%'));
    document.querySelectorAll('[data-progress-text]').forEach((t) => (t.textContent = `${done} / ${all.length} 页 · ${pct}%`));
    document.querySelectorAll('.ch-row[data-id]').forEach((r) => r.classList.toggle('done', isDone(r.dataset.id)));
  }
  Course.updateProgress = updateProgress;

  function buildToc(article, toc) {
    const heads = [...article.querySelectorAll('h2')].filter((h) => !h.closest('.chapter-end'));
    if (heads.length < 2) {
      toc.remove();
      return;
    }
    toc.append(Course.el('b', { text: '本页目录' }));
    const links = heads.map((h, i) => {
      if (!h.id) h.id = 's' + (i + 1);
      const a = Course.el('a', { href: '#' + h.id, text: h.textContent.replace(/^\d+\s*·\s*/, '') });
      toc.append(a);
      return a;
    });
    const spy = () => {
      let cur = 0;
      heads.forEach((h, i) => {
        if (h.getBoundingClientRect().top < 120) cur = i;
      });
      links.forEach((a, i) => a.classList.toggle('on', i === cur));
    };
    addEventListener('scroll', spy, { passive: true });
    spy();
  }

  // ---------- 代码高亮（够用即可的单遍词法着色，不依赖外部库） ----------
  const KEYWORDS = {
    ts: 'const let var function return if else for while do break continue switch case default new class extends implements interface type enum import from export as async await try catch finally throw typeof instanceof in of void null undefined true false this super readonly public private protected static keyof yield',
    py: 'def return if elif else for while break continue import from as class try except finally raise with lambda None True False and or not in is async await pass yield global',
    bash: 'if then else fi for do done while case esac function export echo cd mkdir bun npm npx git gh curl',
    yaml: 'true false null',
    json: 'true false null',
  };
  const ALIAS = { js: 'ts', javascript: 'ts', typescript: 'ts', tsx: 'ts', python: 'py', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml' };

  function highlight(code, lang) {
    lang = ALIAS[lang] || lang;
    if (!KEYWORDS[lang]) return Course.escape(code);
    const kw = new Set(KEYWORDS[lang].split(' '));
    const hashComment = lang === 'py' || lang === 'bash' || lang === 'yaml';
    const re = hashComment
      ? /(#[^\n]*)|("""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(\d+(?:\.\d+)?)\b|([A-Za-z_][\w-]*)/g
      : /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\b(\d+(?:\.\d+)?)\b|([A-Za-z_$][\w$]*)/g;
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(code))) {
      out += Course.escape(code.slice(last, m.index));
      const [tok, com, str, num, word] = m;
      if (com) out += `<span class="tok-c">${Course.escape(com)}</span>`;
      else if (str) out += `<span class="tok-s">${Course.escape(str)}</span>`;
      else if (num) out += `<span class="tok-n">${num}</span>`;
      else if (word && kw.has(word)) out += `<span class="tok-k">${word}</span>`;
      else if (word && lang === 'ts' && /^[A-Z]/.test(word)) out += `<span class="tok-t">${word}</span>`;
      else out += Course.escape(tok);
      last = re.lastIndex;
    }
    return out + Course.escape(code.slice(last));
  }

  function setupCode() {
    document.querySelectorAll('pre > code').forEach((code) => {
      const cls = [...code.classList].find((c) => c.startsWith('lang-'));
      const raw = code.textContent.replace(/^\n/, '').replace(/\s+$/, '');
      if (cls) code.innerHTML = highlight(raw, cls.slice(5));
      else code.textContent = raw;
      const pre = code.parentElement;
      const btn = Course.el('button', { class: 'copy-btn', type: 'button', text: '复制' });
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(raw);
          btn.textContent = '已复制';
        } catch (_) {
          btn.textContent = '复制失败';
        }
        setTimeout(() => (btn.textContent = '复制'), 1500);
      });
      pre.append(btn);
    });
  }

  // ---------- 表格横向滚动 ----------
  function wrapTables() {
    document.querySelectorAll('article table').forEach((t) => {
      if (t.parentElement.classList.contains('table-wrap')) return;
      const w = Course.el('div', { class: 'table-wrap' });
      t.replaceWith(w);
      w.append(t);
    });
  }

  // ---------- 分步动画 ----------
  // <figure class="anim"> 里放一个 SVG（元素用 data-k="键" 标记）和 <ol class="anim-steps">：
  //   <li data-show="a b" data-hide="c" data-hl="b">说明文字</li>
  // data-show 累积显示、data-hide 隐藏、data-hl 只在这一步高亮；从未出现在 data-show 里的 data-k 元素一直可见。
  // 也可以给 figure 加 data-dim：未高亮的已显示元素变淡，突出当前步骤。
  function setupAnims() {
    document.querySelectorAll('figure.anim').forEach((fig) => {
      const steps = [...fig.querySelectorAll('.anim-steps > li')];
      if (!steps.length) return;
      const words = (s) => (s || '').split(/\s+/).filter(Boolean);
      const managed = new Set(steps.flatMap((li) => words(li.dataset.show)));
      const nodes = [...fig.querySelectorAll('[data-k]')];
      const caption = Course.el('div', { class: 'anim-caption', 'aria-live': 'polite' });
      const dots = Course.el('div', { class: 'anim-dots' });
      const prev = Course.el('button', { class: 'btn small', type: 'button', text: '← 上一步' });
      const next = Course.el('button', { class: 'btn small primary', type: 'button', text: '下一步 →' });
      const play = Course.el('button', { class: 'btn small', type: 'button', text: '▶ 自动播放' });
      const reset = Course.el('button', { class: 'btn small', type: 'button', text: '↺ 重来' });
      let i = 0;
      let timer = null;

      const render = () => {
        const visible = new Set();
        for (let s = 0; s <= i; s++) {
          words(steps[s].dataset.show).forEach((k) => visible.add(k));
          words(steps[s].dataset.hide).forEach((k) => visible.delete(k));
        }
        const hl = new Set(words(steps[i].dataset.hl));
        for (const n of nodes) {
          const keys = words(n.dataset.k);
          const shown = keys.some((k) => !managed.has(k) || visible.has(k));
          const lit = keys.some((k) => hl.has(k));
          n.classList.toggle('k-off', !shown);
          n.classList.toggle('hl', lit);
          n.classList.toggle('k-dim', fig.hasAttribute('data-dim') && shown && hl.size > 0 && !lit);
        }
        caption.innerHTML = `<b class="step-no">${i + 1}/${steps.length}</b>${steps[i].innerHTML}`;
        [...dots.children].forEach((d, j) => d.classList.toggle('on', j === i));
        prev.disabled = i === 0;
        next.disabled = i === steps.length - 1;
        fig.dispatchEvent(new CustomEvent('anim:step', { detail: { index: i, step: steps[i] } }));
      };
      const go = (n) => {
        i = Math.max(0, Math.min(steps.length - 1, n));
        render();
      };
      const stop = () => {
        clearInterval(timer);
        timer = null;
        play.textContent = '▶ 自动播放';
      };
      steps.forEach((_, j) => dots.append(Course.el('i', { title: `第 ${j + 1} 步`, onclick: () => (stop(), go(j)) })));
      prev.addEventListener('click', () => (stop(), go(i - 1)));
      next.addEventListener('click', () => (stop(), go(i + 1)));
      reset.addEventListener('click', () => (stop(), go(0)));
      play.addEventListener('click', () => {
        if (timer) return stop();
        if (i === steps.length - 1) go(0);
        play.textContent = '⏸ 暂停';
        timer = setInterval(() => {
          if (i >= steps.length - 1) return stop();
          go(i + 1);
        }, Number(fig.dataset.interval) || 2800);
      });
      const host = fig.querySelector('.diagram') || fig;
      host.after(caption, Course.el('div', { class: 'anim-bar' }, [prev, next, play, reset, dots]));
      fig.animGo = go;
      render();
      fig.classList.add('anim-init'); // 首帧状态就绪后再显示，避免加载时先闪出全部元素
    });
  }

  // ---------- 选项卡 ----------
  // <div class="tabs"><div class="tab-panel" data-label="标题">…</div>…</div>
  function setupTabs() {
    document.querySelectorAll('.tabs').forEach((tabs) => {
      const panels = [...tabs.querySelectorAll(':scope > .tab-panel')];
      const btns = Course.el('div', { class: 'tab-btns', role: 'tablist' });
      panels.forEach((p, j) => {
        const b = Course.el('button', { type: 'button', role: 'tab', text: p.dataset.label || `选项 ${j + 1}` });
        b.addEventListener('click', () => {
          panels.forEach((x, k) => x.classList.toggle('on', k === j));
          [...btns.children].forEach((x, k) => x.classList.toggle('on', k === j));
        });
        btns.append(b);
      });
      tabs.prepend(btns);
      if (panels.length) btns.children[0].click();
    });
  }

  // ---------- 小测 ----------
  // <div class="quiz" data-answer="2"><p class="q">…</p><ol><li>…</li></ol><div class="explain">…</div></div>（答案从 1 开始数）
  function setupQuizzes() {
    document.querySelectorAll('.quiz').forEach((quiz) => {
      const answer = Number(quiz.dataset.answer) - 1;
      const options = [...quiz.querySelectorAll('ol > li')];
      options.forEach((li, j) => {
        li.tabIndex = 0;
        const pick = () => {
          if (quiz.classList.contains('answered')) return;
          quiz.classList.add('answered');
          li.classList.add(j === answer ? 'right' : 'wrong');
          options[answer].classList.add('right');
        };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      });
      const redo = Course.el('button', { class: 'btn small', type: 'button', text: '重做', style: 'margin-top:10px' });
      redo.addEventListener('click', () => {
        quiz.classList.remove('answered');
        options.forEach((o) => o.classList.remove('right', 'wrong'));
      });
      const explain = quiz.querySelector('.explain');
      if (explain) explain.append(Course.el('div', {}, [redo]));
    });
  }

  // ---------- 勾选清单（按页面 + 序号保存） ----------
  function setupChecklists() {
    const page = document.body.dataset.page || 'x';
    document.querySelectorAll('ul.checklist').forEach((ul, u) => {
      [...ul.children].forEach((li, j) => {
        const key = `check:${page}:${ul.dataset.key || u}:${j}`;
        const box = Course.el('input', { type: 'checkbox', 'aria-label': '完成' });
        const span = Course.el('span');
        while (li.firstChild) span.append(li.firstChild);
        li.append(box, span);
        box.checked = store.get(key, false);
        li.classList.toggle('checked', box.checked);
        box.addEventListener('change', () => {
          store.set(key, box.checked);
          li.classList.toggle('checked', box.checked);
        });
      });
    });
  }

  // ---------- 箭头标记（所有内联 SVG 共用 url(#arr) 等） ----------
  function injectMarkers() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'sr-only');
    svg.setAttribute('aria-hidden', 'true');
    const colors = { arr: 'var(--muted)', 'arr-a': 'var(--accent)', 'arr-b': 'var(--accent-2)', 'arr-g': 'var(--ok)', 'arr-r': 'var(--danger)' };
    const defs = document.createElementNS(ns, 'defs');
    for (const [id, color] of Object.entries(colors)) {
      const m = document.createElementNS(ns, 'marker');
      m.setAttribute('id', id);
      m.setAttribute('viewBox', '0 0 10 10');
      m.setAttribute('refX', '9');
      m.setAttribute('refY', '5');
      m.setAttribute('markerWidth', '7');
      m.setAttribute('markerHeight', '7');
      m.setAttribute('orient', 'auto-start-reverse');
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M0,0 L10,5 L0,10 z');
      p.setAttribute('style', `fill:${color}`);
      m.append(p);
      defs.append(m);
    }
    svg.append(defs);
    document.body.prepend(svg);
  }

  function init() {
    injectMarkers();
    buildLayout();
    wrapTables();
    setupCode();
    setupAnims();
    setupTabs();
    setupQuizzes();
    setupChecklists();
    isReady = true;
    readyQueue.splice(0).forEach((fn) => fn());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
