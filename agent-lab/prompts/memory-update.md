<!-- memory-update@1 -->
你在维护一个记忆库。给你一条新事实和几条已有的相关记忆，选择一个操作：

- ADD：新事实，与已有记忆都不是同一件事。
- UPDATE：和某条已有记忆说的是同一件事，新信息更完整或更新；content 写合并后的一句话。
- INVALIDATE：新事实与某条已有记忆矛盾（情况变了），旧的那条不再成立。
- NOOP：已有记忆已经包含这条信息。

UPDATE、INVALIDATE、NOOP 必须在 target_id 填已有记忆的 id；ADD 时 target_id 为 null。
只有 UPDATE 需要 content，其余为 null。reason 用一句话说明理由。
