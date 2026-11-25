import { sh } from './sh';

// 客观进度：不听 agent 自己说做到哪了，直接读 git 和 gh。
export type CiState = 'none' | 'pending' | 'success' | 'failure';
export type Snapshot = {
  dirty: string[];
  commits: string[];
  unpushed: number; // 不在任何远端分支上的本地提交数
  pr: { url: string; state: string } | null;
  ci: CiState;
};

type Check = { __typename?: string; status?: string; conclusion?: string | null; state?: string };

// gh 的 statusCheckRollup 里混着两种记录：CheckRun（status + conclusion）与 StatusContext（state）。
export function classifyChecks(checks: Check[]): CiState {
  if (checks.length === 0) return 'none';
  const BAD = ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];
  const results = checks.map((c) => {
    if (c.__typename === 'StatusContext' || (c.state && !c.status)) {
      const s = (c.state ?? '').toUpperCase();
      return BAD.includes(s) ? 'failure' : s === 'SUCCESS' ? 'success' : 'pending';
    }
    if ((c.status ?? '').toUpperCase() !== 'COMPLETED') return 'pending';
    const conclusion = (c.conclusion ?? '').toUpperCase();
    return BAD.includes(conclusion) ? 'failure' : 'success'; // SUCCESS、NEUTRAL、SKIPPED 都不挡路
  });
  if (results.includes('failure')) return 'failure';
  if (results.includes('pending')) return 'pending';
  return 'success';
}

export async function snapshot(path: string, base: string): Promise<Snapshot> {
  const status = await sh(['git', 'status', '--porcelain'], path);
  const log = await sh(['git', 'log', '--oneline', `origin/${base}..HEAD`], path);
  // 不和 @{u} 比：从 origin/main 建出的分支默认跟踪 origin/main，推送时没加 -u 会把已推送的提交也算进来
  const ahead = await sh(['git', 'rev-list', '--count', 'HEAD', '--not', '--remotes'], path);
  const pr = await sh(['gh', 'pr', 'view', '--json', 'url,state,statusCheckRollup'], path);
  let prInfo: Snapshot['pr'] = null;
  let ci: CiState = 'none';
  if (pr.code === 0) {
    const data = JSON.parse(pr.stdout) as { url: string; state: string; statusCheckRollup: Check[] | null };
    prInfo = { url: data.url, state: data.state };
    ci = classifyChecks(data.statusCheckRollup ?? []);
  }
  return {
    dirty: status.stdout ? status.stdout.split('\n') : [],
    commits: log.stdout ? log.stdout.split('\n') : [],
    unpushed: ahead.code === 0 ? Number(ahead.stdout) : 0,
    pr: prInfo,
    ci,
  };
}

export function describe(s: Snapshot): string {
  return [
    `未提交 ${s.dirty.length} 个文件`,
    `新提交 ${s.commits.length} 个`,
    `待推送 ${s.unpushed}`,
    s.pr ? `PR ${s.pr.state} ${s.pr.url}` : '无 PR',
    `CI ${s.ci}`,
  ].join(' · ');
}
