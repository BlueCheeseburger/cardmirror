/**
 * Custom dash autoformat, gated on the `customDash*` settings (default off).
 *
 * As you type the last hyphen of the configured trigger (`---` classic, or
 * `--`), it's replaced with the configured dash output (en/em dash, with or
 * without surrounding spaces). Optionally BOTH triggers convert at once
 * (`customDashOtherEnabled`) — Word's usual behavior — each to its own
 * style: whichever of the pair targets `--` then can't fire eagerly on the
 * second hyphen anymore (it can't yet know whether a third is coming, which
 * would belong to the `---` rule instead), so it defers to the character
 * typed right after the pair, converting then. With only one trigger active,
 * nothing changes — the `--` rule still fires eagerly on the second hyphen,
 * exactly as before. Neither firing mode converts mid-hyphen-run (e.g. after
 * pasted hyphens or ASCII rules), so only a clean sequence converts. (The run
 * guard originally protected only `--`; `---` gained it in the 2026-07-13
 * review — a hyphen typed at the end of `----` used to convert the trailing
 * three.)
 *
 * Conversion mechanics + the Backspace-revert window live in the shared
 * autocorrect engine (autocorrect.ts) — this module is just the rules. The
 * revert restores the trigger as configured AT CONVERSION TIME (captured in
 * `revertTo`), so a settings change inside the revert window can't restore
 * the wrong literal.
 */

import { PluginKey } from 'prosemirror-state';
import type { Plugin } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import { settings } from './settings.js';
import type { Settings } from './settings.js';
import { makeAutocorrectPlugin, type AutocorrectRule, type AutocorrectMatch, type AutocorrectState } from './autocorrect.js';

/** The literal string each dash style produces. Spaced variants use a regular
 *  space on each side. */
const DASH_OUTPUT: Record<Settings['customDashStyle'], string> = {
  en: '–',
  'en-spaced': ' – ',
  em: '—',
  'em-spaced': ' — ',
};

/** The output string for the current `customDashStyle` (the primary rule's
 *  style). Exported for tests. */
export function dashOutput(): string {
  return DASH_OUTPUT[settings.get('customDashStyle')];
}

export const customDashKey = new PluginKey<AutocorrectState>('pmd-custom-dash');

/** The trigger `customDashTrigger` ISN'T — what the secondary rule targets
 *  when `customDashOtherEnabled` is on. */
function otherTrigger(): '---' | '--' {
  return settings.get('customDashTrigger') === '---' ? '--' : '---';
}

/** True when a `---`-targeting rule is currently active (either as the
 *  primary rule or the secondary one) — the only thing that forces a
 *  `--`-targeting rule to defer instead of firing eagerly on the second
 *  hyphen. */
function tripleRuleActive(): boolean {
  if (!settings.get('customDashEnabled')) return false;
  if (settings.get('customDashTrigger') === '---') return true;
  return settings.get('customDashOtherEnabled') && otherTrigger() === '---';
}

/** One dash-conversion rule. `trigger`/`style`/`enabled` are getters so the
 *  rule always reads live settings (the primary and secondary rules share
 *  this shape, just pointed at different settings keys). */
function makeDashRule(opts: {
  trigger: () => '---' | '--';
  style: () => Settings['customDashStyle'];
  enabled: () => boolean;
}): AutocorrectRule {
  const deferred = (): boolean => opts.trigger() === '--' && tripleRuleActive();
  return {
    triggers(text) {
      if (text === '-') return true;
      // Non-hyphen keystrokes only matter for the deferred completion
      // case below (both triggers active, this one is the `--` rule).
      return opts.enabled() && deferred();
    },
    enabled: opts.enabled,
    match(state: EditorState, from: number, _to: number, text: string): AutocorrectMatch | null {
      const trigger = opts.trigger();
      const isDeferred = deferred();
      if (text === '-') {
        if (isDeferred) return null; // let a completing 3rd hyphen go to the other rule instead
        const need = trigger.length - 1;
        const $from = state.doc.resolve(from);
        if ($from.parentOffset < need) return null;
        if (state.doc.textBetween(from - need, from) !== '-'.repeat(need)) return null;
        // Don't convert inside a longer hyphen run (pasted hyphens, ASCII
        // art) — only a clean sequence fires.
        if (
          $from.parentOffset > need &&
          state.doc.textBetween(from - need - 1, from - need) === '-'
        ) {
          return null;
        }
        return { replaceFrom: from - need, insert: DASH_OUTPUT[opts.style()], revertTo: trigger };
      }
      // Deferred completion: this rule targets `--`, a `---` rule is also
      // active, and the user just typed something other than a hyphen right
      // after exactly two of them — convert now, since a third hyphen isn't
      // coming (it would have hit the `text === '-'` branch instead).
      if (!isDeferred) return null;
      const $from = state.doc.resolve(from);
      if ($from.parentOffset < 2) return null;
      if (state.doc.textBetween(from - 2, from) !== '--') return null;
      if ($from.parentOffset > 2 && state.doc.textBetween(from - 3, from - 2) === '-') {
        return null;
      }
      return {
        replaceFrom: from - 2,
        insert: DASH_OUTPUT[opts.style()] + text,
        revertTo: '--' + text,
      };
    },
  };
}

const primaryDashRule = makeDashRule({
  trigger: () => settings.get('customDashTrigger'),
  style: () => settings.get('customDashStyle'),
  enabled: () => settings.get('customDashEnabled'),
});

const secondaryDashRule = makeDashRule({
  trigger: otherTrigger,
  style: () => settings.get('customDashOtherStyle'),
  enabled: () => settings.get('customDashEnabled') && settings.get('customDashOtherEnabled'),
});

export function customDashPlugin(): Plugin<AutocorrectState> {
  return makeAutocorrectPlugin(customDashKey, [primaryDashRule, secondaryDashRule]);
}
