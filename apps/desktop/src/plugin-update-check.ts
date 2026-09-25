/**
 * Automatic plugin update checks (fork, 2026-09-25).
 *
 * Plugins are checked whenever the app checks itself for updates: at
 * launch and daily after that (the renderer's schedule, gated on the
 * same "Check for updates automatically" setting and tournament
 * pause), plus the manual app checks. Anything found goes on the
 * status-bar update chip, and clicking the chip installs them (see
 * main.ts "Update chip"). The per-plugin "Check for updates" button in
 * Settings → Plugins still works on its own.
 *
 * Pure orchestration over injected plugin-manager calls, so it tests
 * without Electron.
 */

import type { InstalledPluginInfo } from './plugin-manager.js';

/** One installed plugin with a newer release. */
export interface PluginUpdate {
  id: string;
  name: string;
  repo: string;
  current: string;
  latest: string;
}

type CheckResult =
  | { ok: true; latest: string; hasUpdate: boolean }
  | { ok: false; error: string };

/** Installed plugins with a newer release. Skips plugins without a
 *  source repo (loaded from a file) and ones this app build can't run.
 *  A plugin whose check fails is left out, silently, like a failed
 *  automatic app check. Checked one at a time to stay gentle on
 *  GitHub's unauthenticated rate limit. */
export async function findPluginUpdates(
  installed: InstalledPluginInfo[],
  check: (id: string, repo: string) => Promise<CheckResult>,
): Promise<PluginUpdate[]> {
  const out: PluginUpdate[] = [];
  for (const p of installed) {
    if (!p.repo || p.incompatible) continue;
    let res: CheckResult;
    try {
      res = await check(p.id, p.repo);
    } catch {
      continue;
    }
    if (res.ok && res.hasUpdate) {
      out.push({ id: p.id, name: p.name, repo: p.repo, current: p.version, latest: res.latest });
    }
  }
  return out;
}

type InspectResult = { ok: true; pending: string } | { ok: false; error: string };
type CommitResult = { ok: true } | { ok: false; error: string };

/** Install each update: the same two-phase inspect → commit the
 *  Settings row's update button runs. The user's click on the chip is
 *  the consent, as the row's confirm is for a same-repo reinstall. */
export async function applyPluginUpdates(
  updates: PluginUpdate[],
  inspect: (repo: string) => Promise<InspectResult>,
  commit: (token: string) => Promise<CommitResult>,
): Promise<{ updated: PluginUpdate[]; failed: { update: PluginUpdate; error: string }[] }> {
  const updated: PluginUpdate[] = [];
  const failed: { update: PluginUpdate; error: string }[] = [];
  for (const u of updates) {
    try {
      const ins = await inspect(u.repo);
      if (!ins.ok) {
        failed.push({ update: u, error: ins.error });
        continue;
      }
      const r = await commit(ins.pending);
      if (r.ok) updated.push(u);
      else failed.push({ update: u, error: r.error });
    } catch (err) {
      failed.push({ update: u, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { updated, failed };
}

/** The dialog text listing what an update click will install. */
export function describePluginUpdates(updates: PluginUpdate[]): string {
  return updates.map((u) => `${u.name}: v${u.current} → v${u.latest}`).join('\n');
}
