import { Database } from 'bun:sqlite';
import { migrations } from './migrations';

// WAL：CLI 和后台进程可以同时读写同一个库；busy_timeout：写冲突时等一会儿而不是立刻报错。
export function openDb(path = 'agent-lab.db'): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database): void {
  const { user_version: current } = db.query('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.run(migrations[v]!);
      db.run(`PRAGMA user_version = ${v + 1}`);
    })();
  }
}
