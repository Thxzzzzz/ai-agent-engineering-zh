# AI Agent 工程

一套中文引导式教程：从"会调模型 API"到"能设计、交付并长期运维一个生产级 agent 系统"的高级工程师。

- **16 章理论**：agent loop、模型工程、结构化输出与工具、上下文工程、记忆、检索、人在回路、安全、可靠执行、协议（MCP / A2A / Skills）、长任务与编码 agent、评测、可观测与成本、参考架构。
- **真实项目复盘**：对照全课知识点，逐条复盘 niuma-agent 与 devtask 因缺少哪些知识而没做好（31 条有证据的发现），每条对比"缺这块知识时"与"有这块知识时"的设计，附整改清单。
- **名作研读**：Claude Code（官方文档与社区分析）、Codex CLI、Gemini CLI、OpenHands、SWE-agent、Aider、Letta、LangGraph、goose，每篇固定到具体提交、附源码行号链接，并对照课程章节与复盘条目。
- **7 个跟练项目 + 1 个毕业项目**：在同一个 `agent-lab` 仓库里，用 TypeScript（Bun）从 100 行的最小 agent 一路长成带审批、记忆、MCP、评测和编码驾驭器的系统。
- **图文并茂**：每章有 SVG 图解、可单步播放的动画、交互组件与小测；学习进度保存在浏览器本地。

事实性内容（规范版本、价格倍数、基准分数等）核实于 2026-11，正文注明出处与日期；之后请以原文为准。

## 阅读

纯静态页面，没有构建步骤，也不依赖任何外部 CDN：

```bash
# 直接用浏览器打开
open index.html

# 或起一个本地静态服务
python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

也可以开启 GitHub Pages（Settings → Pages → Deploy from branch → `main` / root）在线阅读。

## 目录结构

```
index.html                 学习地图
ch00-*.html … ch15-*.html  正文各章
review.html                真实项目复盘
cases.html, case-*.html    名作研读
projects.html, p1-*.html … p7-*.html, capstone.html   跟练项目
agent-lab/                 跟练项目的完整参考实现（bun test 70 个测试）
skills.html, glossary.html, resources.html            附录
assets/js/manifest.js      课程目录（侧边栏、翻页、进度都由它生成）
assets/js/course.js        页面骨架与交互组件（分步动画、选项卡、小测、清单、代码高亮）
assets/css/course.css      全站样式与明暗主题
scripts/check.sh           页面验收：JS 报错、骨架、手机宽度溢出、站内链接
scripts/sync-code.py       把 agent-lab 的代码同步进项目页的代码块
```

## 新增或修改页面

1. 复制任意一章作为模板，改 `<body data-page="…">` 与正文。
2. 在 `assets/js/manifest.js` 登记这一页（`minutes` 字段决定它是否计入学习进度）。
3. 分步动画：在 `<figure class="anim">` 里给 SVG 元素加 `data-k`，在 `<ol class="anim-steps">` 的每个 `<li>` 上用 `data-show` / `data-hide` / `data-hl` 描述这一步，具体约定见 `course.js` 的注释。
