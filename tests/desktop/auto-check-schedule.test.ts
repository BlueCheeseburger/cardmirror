// @vitest-environment node
/**
 * Which automatic update checks run when the renderer asks (every window,
 * once a minute while focused, and on every focus event).
 */
import { describe, expect, it } from 'vitest';
import {
  AUTO_PLUGIN_CHECK_GAP_MS,
  AUTO_UPDATE_CHECK_GAP_MS,
  planAutoCheck,
  type AutoCheckClock,
} from '../../apps/desktop/src/auto-check-schedule.js';

const T = 1_000_000_000_000;
const never: AutoCheckClock = { app: 0, plugins: 0 };
const due = { onlyIfDue: true, updatePending: false };

describe('planAutoCheck', () => {
  it('the launch check always runs both and starts both clocks', () => {
    const plan = planAutoCheck(T, { app: T - 1, plugins: T - 1 }, { onlyIfDue: false, updatePending: true });
    expect(plan).toEqual({ app: true, plugins: true, clock: { app: T, plugins: T } });
  });

  it('a first foreground tick after launch-less startup runs both', () => {
    const plan = planAutoCheck(T, never, due);
    expect(plan.app).toBe(true);
    expect(plan.plugins).toBe(true);
    expect(plan.clock).toEqual({ app: T, plugins: T });
  });

  it('checks the app every 15 minutes and no sooner', () => {
    const clock = { app: T, plugins: T };
    expect(planAutoCheck(T + AUTO_UPDATE_CHECK_GAP_MS - 1, clock, due).app).toBe(false);
    const at = planAutoCheck(T + AUTO_UPDATE_CHECK_GAP_MS, clock, due);
    expect(at.app).toBe(true);
    expect(at.clock.app).toBe(T + AUTO_UPDATE_CHECK_GAP_MS);
  });

  it('checks plugins hourly, on their own clock', () => {
    const clock = { app: T, plugins: T };
    const quarter = planAutoCheck(T + AUTO_UPDATE_CHECK_GAP_MS, clock, due);
    expect(quarter.app).toBe(true);
    expect(quarter.plugins).toBe(false);
    expect(quarter.clock.plugins).toBe(T); // untouched until it runs
    const hour = planAutoCheck(T + AUTO_PLUGIN_CHECK_GAP_MS, quarter.clock, due);
    expect(hour.plugins).toBe(true);
  });

  it('many windows and focus events in one minute run one check', () => {
    let clock = never;
    let runs = 0;
    for (let i = 0; i < 20; i++) {
      const plan = planAutoCheck(T + i * 1000, clock, due);
      if (plan.app) runs++;
      clock = plan.clock;
    }
    expect(runs).toBe(1);
  });

  it('runs nothing while an update is already found, and leaves the clocks alone', () => {
    const clock = { app: T - 10 * AUTO_PLUGIN_CHECK_GAP_MS, plugins: T - 10 * AUTO_PLUGIN_CHECK_GAP_MS };
    const plan = planAutoCheck(T, clock, { onlyIfDue: true, updatePending: true });
    expect(plan).toEqual({ app: false, plugins: false, clock });
  });

  it('a machine that slept through many gaps checks once on wake, not once per missed gap', () => {
    const clock = { app: T, plugins: T };
    const wake = planAutoCheck(T + 6 * AUTO_PLUGIN_CHECK_GAP_MS, clock, due);
    expect(wake.app).toBe(true);
    expect(planAutoCheck(T + 6 * AUTO_PLUGIN_CHECK_GAP_MS + 1000, wake.clock, due).app).toBe(false);
  });
});
