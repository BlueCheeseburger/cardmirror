/**
 * When the automatic update checks actually run.
 *
 * The renderer asks often — every window, once a minute while it has
 * focus, and again on every focus event — and this is the one place that
 * decides whether a check is due. Pure so it can be tested without
 * Electron; `main.ts` keeps the clock and does the checking.
 */

/** Minimum gap between automatic app-update checks. */
export const AUTO_UPDATE_CHECK_GAP_MS = 15 * 60 * 1000;
/** Plugins are checked against GitHub one repo at a time, so they ride
 *  the same trigger on a slower clock. */
export const AUTO_PLUGIN_CHECK_GAP_MS = 60 * 60 * 1000;

/** When each automatic check last ran (epoch ms; 0 = never). */
export interface AutoCheckClock {
  app: number;
  plugins: number;
}

export interface AutoCheckPlan {
  app: boolean;
  plugins: boolean;
  /** The clock after running what `app` / `plugins` say to run. */
  clock: AutoCheckClock;
}

/**
 * Decide which automatic checks to run now.
 *
 * - `onlyIfDue: false` (the launch check): always runs both, and starts
 *   both clocks.
 * - `onlyIfDue: true` (the foreground tick and focus events): each check
 *   runs only once its gap has passed since it last ran, and the APP check
 *   doesn't run while an app update is already found (`updatePending`, the
 *   status-bar chip is downloading or ready) — a second `update-available`
 *   would restart the chip's download. Plugins are unaffected: their check
 *   never touches the app's download.
 */
export function planAutoCheck(
  now: number,
  clock: AutoCheckClock,
  opts: { onlyIfDue: boolean; updatePending: boolean },
): AutoCheckPlan {
  if (!opts.onlyIfDue) return { app: true, plugins: true, clock: { app: now, plugins: now } };
  const app = !opts.updatePending && now - clock.app >= AUTO_UPDATE_CHECK_GAP_MS;
  const plugins = now - clock.plugins >= AUTO_PLUGIN_CHECK_GAP_MS;
  return {
    app,
    plugins,
    clock: { app: app ? now : clock.app, plugins: plugins ? now : clock.plugins },
  };
}
