# agent-lab

《AI Agent 工程》跟练项目 P1–P7 的参考实现。七个项目在同一个仓库里逐步生长：从 100 行的最小 agent，到结构化分诊、审批与幂等发送、长期记忆、MCP、评测流水线和编码 agent 驾驭器。

建议先按课程页面自己写，卡住了再来对照。课程页面里的代码就是从这里直接生成的。

## 环境

- Bun 1.3+，TypeScript（严格模式），ESM
- 依赖：`zod` 4、`@modelcontextprotocol/server` 与 `@modelcontextprotocol/client`（P5）

```bash
bun install
bun test             # 全部测试，用 FakeModel 离线运行，不调用真实模型
bun run typecheck    # tsc --noEmit；Bun 运行时不检查类型，两个都要跑
```

## 项目与目录

| 项目 | 课程页面 | 目录与文件 |
|---|---|---|
| P1 最小 Agent | `p1-minimal-loop.html` | `src/model.ts`（模型接口）、`src/fake-model.ts`、`src/tools.ts`、`src/loop.ts`（`runAgent`）、`src/models/openai-compatible.ts`、`src/main.ts`、`notes/` |
| P2 工单分诊管线 | `p2-triage.html` | `src/structured.ts`（`completeStructured`）、`src/triage/`、`prompts/triage.md`、`tickets.json` |
| P3 提案与审批 | `p3-approval.html` | `src/store/`（SQLite 与迁移）、`src/proposals.ts`（状态机）、`src/policy.ts`、`src/outbox.ts`、`src/senders.ts`、`src/fake-message-api.ts`、`src/cli.ts` |
| P4 长期记忆 | `p4-memory.html` | `src/memory/`、`prompts/memory-*.md` |
| P5 MCP | `p5-mcp.html` | `mcp-server/`（日程 MCP 服务）、`src/mcp-client.ts`、`src/main-mcp.ts` |
| P6 评测流水线 | `p6-evals.html` | `evals/`、`.github/workflows/evals.yml` |
| P7 编码 Agent 驾驭器 | `p7-coding-harness.html` | `harness/`、`tasks/` |

测试都在 `tests/`，每个测试前的注释写明它拦的是哪种 bug。

## 常用命令

```bash
bun run agent "上海现在几点？(1200-300)*1.06 是多少？"           # P1：跑一次 agent
bun run triage tickets.json                                      # P2：批量分诊

bun run cli triage tickets.json      # P3：分诊并生成待审批的回复提案
bun run cli list                     #     列出提案
bun run cli approve <id> --edit "改写后的正文"
bun run cli reject <id> --reason "理由"
bun run cli send                     #     发出发件箱里排队的消息（带幂等键，重复执行不会重发）

bun run src/memory/main.ts ingest chat.json        # P4：从对话抽取并更新记忆
bun run src/memory/main.ts recall "月报导出谁负责"   #     检索并显示打分明细
bun run src/memory/main.ts profile 同事甲           #     综合一份人物档案

bun run mcp-pin                      # P5：审阅 MCP 工具定义并写入 mcp-lock.json
bun run mcp                          #     用 MCP 日程工具跑一次 agent

bun run evals --suite regression --k 3   # P6：跑回归评测（需要真实模型）

bun run harness tasks/export-filter.json # P7：驾驭编码 agent 完成一个开发任务（先改任务里的 repo 路径）
```

P3、P4 的数据默认写在当前目录的 `agent-lab.db`，可用环境变量 `AGENT_LAB_DB` 指定别的路径。P7 的 worktree 建在 `~/.agent-lab/worktrees/`，收尾时把 `.harness/` 归档到 `~/.agent-lab/runs/`。

## 接入真实模型

所有项目只依赖 `src/model.ts` 里的 `Model` 接口。自带的适配器 `OpenAICompatibleModel` 直连任意 OpenAI Chat Completions 兼容端点（云厂商、模型网关或本机推理服务），模型需要支持工具调用。

```bash
cp .env.example .env    # 然后填入下面三项；Bun 会自动读取 .env
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=你的密钥
LLM_MODEL=模型名
```

`.env` 已在 `.gitignore` 里，不要把密钥提交进仓库。P6 的 CI 配置从仓库 Secrets 读取同名变量；它在 `agent-lab` 作为独立仓库的根目录时才会被 GitHub Actions 执行。

P7 另外需要本机装好编码 agent 的命令行（默认 `claude`，也支持 `codex`），并已登录。

## 数据库迁移

迁移清单在 `src/store/migrations.ts`，按顺序执行、只往末尾追加；改表就加一条新迁移，不改已有的。
