// 尽早应用保存的主题，避免页面先闪一下默认主题（本文件在 <head> 里同步加载）。
try {
  const t = localStorage.getItem('aec:theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (_) {}

// 课程目录：侧边栏、上一页/下一页、首页进度都从这里生成。新增页面只改这一处。
window.COURSE = {
  title: 'AI Agent 工程',
  subtitle: '从会调 API 到能扛起生产级 Agent 系统的高级工程师',
  parts: [
    {
      name: '起点',
      items: [
        { id: 'index', file: 'index.html', title: '学习地图', short: '学习地图' },
        { id: 'ch00', file: 'ch00-roadmap.html', title: '导论：Agent 工程师的能力版图', short: '导论', minutes: 25 },
      ],
    },
    {
      name: '第一部分 · 基础',
      items: [
        { id: 'ch01', file: 'ch01-what-is-agent.html', title: 'Agent 是什么：从 LLM 到智能体', short: 'Agent 是什么', minutes: 30 },
        { id: 'ch02', file: 'ch02-llm-fundamentals.html', title: '模型工程基础：Token、上下文、推理与成本', short: '模型工程基础', minutes: 35 },
        { id: 'ch03', file: 'ch03-structured-tools.html', title: '结构化输出与工具调用', short: '结构化输出与工具', minutes: 40 },
        { id: 'ch04', file: 'ch04-agent-loop.html', title: '手写 Agent Loop', short: '手写 Agent Loop', minutes: 40 },
      ],
    },
    {
      name: '第二部分 · 上下文与记忆',
      items: [
        { id: 'ch05', file: 'ch05-context-engineering.html', title: '上下文工程', short: '上下文工程', minutes: 40 },
        { id: 'ch06', file: 'ch06-memory.html', title: '记忆系统：让 Agent 记得住、记得对', short: '记忆系统', minutes: 45 },
        { id: 'ch07', file: 'ch07-retrieval.html', title: '检索与知识库', short: '检索与知识库', minutes: 35 },
      ],
    },
    {
      name: '第三部分 · 可控与可靠',
      items: [
        { id: 'ch08', file: 'ch08-hitl-autonomy.html', title: '人在回路与自主度', short: '人在回路与自主度', minutes: 40 },
        { id: 'ch09', file: 'ch09-security.html', title: 'Agent 安全：提示注入与权限边界', short: 'Agent 安全', minutes: 45 },
        { id: 'ch10', file: 'ch10-durable-execution.html', title: '可靠执行：状态机、幂等与持久化', short: '可靠执行', minutes: 40 },
      ],
    },
    {
      name: '第四部分 · 协作与规模',
      items: [
        { id: 'ch11', file: 'ch11-protocols.html', title: '多 Agent 与协议：MCP、A2A、Skills', short: '多 Agent 与协议', minutes: 45 },
        { id: 'ch12', file: 'ch12-long-running.html', title: '长任务与编码 Agent 的驾驭', short: '长任务与编码 Agent', minutes: 45 },
        { id: 'ch13', file: 'ch13-evals.html', title: '评测：让 Agent 可度量地变好', short: '评测', minutes: 45 },
        { id: 'ch14', file: 'ch14-observability.html', title: '可观测性、成本与运维', short: '可观测与成本', minutes: 35 },
      ],
    },
    {
      name: '第五部分 · 综合',
      items: [
        { id: 'ch15', file: 'ch15-reference-architecture.html', title: '参考架构：设计一个生产级 Agent 系统', short: '参考架构', minutes: 40 },
        { id: 'review', file: 'review.html', title: '复盘：两个真实项目里的知识短板', short: '真实项目复盘', minutes: 50 },
      ],
    },
    {
      name: '跟练项目',
      items: [
        { id: 'projects', file: 'projects.html', title: '跟练项目总览', short: '项目总览' },
        { id: 'p1', file: 'p1-minimal-loop.html', title: 'P1 · 100 行写一个 Agent', short: 'P1 最小 Agent', minutes: 90 },
        { id: 'p2', file: 'p2-triage.html', title: 'P2 · 工单分诊管线（结构化输出）', short: 'P2 分诊管线', minutes: 120 },
        { id: 'p3', file: 'p3-approval.html', title: 'P3 · 提案与审批（状态机 + 幂等）', short: 'P3 审批流', minutes: 150 },
        { id: 'p4', file: 'p4-memory.html', title: 'P4 · 长期记忆模块', short: 'P4 记忆', minutes: 150 },
        { id: 'p5', file: 'p5-mcp.html', title: 'P5 · 写一个 MCP Server 并接入', short: 'P5 MCP', minutes: 120 },
        { id: 'p6', file: 'p6-evals.html', title: 'P6 · 评测流水线', short: 'P6 评测', minutes: 150 },
        { id: 'p7', file: 'p7-coding-harness.html', title: 'P7 · 编码 Agent 驾驭器', short: 'P7 编码驾驭器', minutes: 150 },
        { id: 'capstone', file: 'capstone.html', title: '毕业项目：做一个能放进作品集的 Agent', short: '毕业项目', minutes: 0 },
      ],
    },
    {
      name: '附录',
      items: [
        { id: 'skills', file: 'skills.html', title: '能力自测：高级 Agent 工程师清单', short: '能力自测' },
        { id: 'glossary', file: 'glossary.html', title: '术语表', short: '术语表' },
        { id: 'resources', file: 'resources.html', title: '精选资料库', short: '资料库' },
      ],
    },
  ],
};
