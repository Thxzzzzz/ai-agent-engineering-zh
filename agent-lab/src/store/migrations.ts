// 迁移按顺序执行，已执行到第几个记在 SQLite 的 user_version 里。只追加，不修改已发布的迁移。
export const migrations: string[] = [
  // 1：提案、发件箱、事件日志（P3）
  `
  CREATE TABLE proposals (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,              -- reply：代发回复；profile_update：改人物档案（P4）
    target        TEXT NOT NULL,              -- 发给谁 / 改谁的档案
    body          TEXT NOT NULL,              -- 模型起草的内容
    final_body    TEXT,                       -- 批准时的内容（可能被人改写过）
    status        TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','expired','executing','done','failed')),
    confidence    REAL NOT NULL,
    source_ref    TEXT NOT NULL,              -- 依据的工单 / 消息 id
    auto_approved INTEGER NOT NULL DEFAULT 0,
    reason        TEXT,                       -- 拒绝理由、策略判断
    error         TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    expires_at    INTEGER NOT NULL
  );
  CREATE INDEX proposals_status ON proposals(status);
  CREATE TABLE outbox (
    idempotency_key TEXT PRIMARY KEY,         -- 提案 id + 正文的哈希：同一内容只会有一行
    proposal_id     TEXT NOT NULL REFERENCES proposals(id),
    target          TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('queued','sent','failed')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    remote_id       TEXT,
    last_error      TEXT,
    created_at      INTEGER NOT NULL,
    sent_at         INTEGER
  );
  CREATE TABLE events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id TEXT NOT NULL,
    type        TEXT NOT NULL,
    detail      TEXT,
    at          INTEGER NOT NULL
  );
  `,
  // 2：长期记忆与人物档案（P4）
  `
  CREATE TABLE memories (
    id                TEXT PRIMARY KEY,
    subject           TEXT NOT NULL,          -- 关于谁 / 什么：一个人、一个项目，或 "me"
    content           TEXT NOT NULL,          -- 一句话事实
    source_message_id TEXT NOT NULL,          -- 出处，可追溯
    importance        INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
    origin            TEXT NOT NULL CHECK (origin IN ('auto', 'manual')),
    created_at        INTEGER NOT NULL,       -- 我们什么时候记下的（系统时间）
    last_accessed_at  INTEGER NOT NULL,       -- 最近一次被检索到
    valid_from        INTEGER NOT NULL,       -- 这件事从什么时候起成立（事件时间）
    valid_to          INTEGER,                -- 什么时候不再成立；NULL = 仍然有效
    supersedes        TEXT REFERENCES memories(id)
  );
  CREATE INDEX memories_valid_subject ON memories(subject) WHERE valid_to IS NULL;
  CREATE VIRTUAL TABLE memories_fts USING fts5(memory_id UNINDEXED, subject, content, tokenize = 'trigram');
  CREATE TABLE profiles (
    subject      TEXT PRIMARY KEY,
    profile      TEXT NOT NULL,               -- 模型综合出的档案（JSON）
    manual_notes TEXT NOT NULL DEFAULT '',    -- 人手写的备注，自动流程永不覆盖
    updated_at   INTEGER NOT NULL
  );
  `,
];
