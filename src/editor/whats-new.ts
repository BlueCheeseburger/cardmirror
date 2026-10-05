/**
 * "What's new" popup, shown once after the app updates.
 *
 * On the first launch of a new version the desktop app fetches that
 * version's release notes from the GitHub releases page (the same text a
 * person would read there) and shows them in a dialog. The last version
 * the user has seen is kept in `localStorage` under a marker outside the
 * settings blob, so every window of the install shares it and a settings
 * reset doesn't replay old notes.
 *
 * Quiet by design: a fresh install, a failed or slow fetch, a release
 * with no notes, the web edition and the Lite build all show nothing. A
 * failed fetch leaves the marker alone, so the notes come up on a later
 * launch instead of being lost.
 */

import { pushOverlay, popOverlay } from './overlay-stack.js';
import { installModalKeys, captureFocusForDialog } from './text-prompt.js';

const MARKER = 'cm-whats-new-last-version';
const SETTINGS_KEY = 'pmd-settings';
const REPO_URL = 'https://github.com/BlueCheeseburger/cardmirror';
const FETCH_TIMEOUT_MS = 8000;

/** True when the settings blob already existed as this module loaded: a
 *  returning install, not a first run. Captured at import time because
 *  the settings store starts writing the blob almost immediately. */
const hadSettingsAtLoad = ((): boolean => {
  try {
    return localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
})();

export type WhatsNewDecision = 'show' | 'record' | 'none';

/** What to do at launch. `stored` is the last version the user was shown
 *  notes for (null: never). A fresh install just records its version; a
 *  returning install with no marker yet (the one that updated into the
 *  release that added this popup) is shown the current notes. */
export function decideWhatsNew(opts: {
  stored: string | null;
  current: string;
  returningInstall: boolean;
}): WhatsNewDecision {
  if (opts.stored === opts.current) return 'none';
  if (opts.stored === null && !opts.returningInstall) return 'record';
  return 'show';
}

/** The GitHub API URL for one release, by tag. */
export function releaseApiUrl(version: string): string {
  return `https://api.github.com/repos/BlueCheeseburger/cardmirror/releases/tags/v${encodeURIComponent(version)}`;
}

/** The release's notes (markdown), or null when there are none or the
 *  request failed. */
export async function fetchReleaseNotes(
  version: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchFn(releaseApiUrl(version), {
      headers: { Accept: 'application/vnd.github+json' },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { body?: unknown };
    const body = typeof json.body === 'string' ? json.body.trim() : '';
    return body === '' ? null : body;
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering — the small subset release notes use. Everything goes
// through textContent / createElement, never innerHTML, so a release body
// can't inject markup.
// ---------------------------------------------------------------------------

/** Only web links open out of the dialog. */
function safeHref(href: string): string | null {
  return /^https?:\/\//i.test(href) ? href : null;
}

function appendInline(parent: HTMLElement, text: string): void {
  // Code spans, bold, and [text](url) links; anything else is literal.
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[1] !== undefined) {
      const code = document.createElement('code');
      code.textContent = m[1];
      parent.append(code);
    } else if (m[2] !== undefined) {
      const strong = document.createElement('strong');
      appendInline(strong, m[2]);
      parent.append(strong);
    } else {
      const href = safeHref(m[4]!);
      if (href) {
        const a = document.createElement('a');
        a.href = href;
        a.rel = 'noopener noreferrer';
        a.textContent = m[3]!;
        parent.append(a);
      } else {
        parent.append(m[0]);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

/** Render release-note markdown to a detached element: `#`–`####` headings,
 *  `-`/`*` bullets (with indented continuation lines), paragraphs, and
 *  inline code, bold and links. */
export function renderReleaseNotes(markdown: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'pmd-whatsnew-notes';
  let list: HTMLUListElement | null = null;
  let item: HTMLLIElement | null = null;
  let para: HTMLParagraphElement | null = null;
  let paraText: string[] = [];

  const flushPara = (): void => {
    if (para && paraText.length > 0) appendInline(para, paraText.join(' '));
    para = null;
    paraText = [];
  };
  const flushItem = (itemText: string[]): void => {
    if (item && itemText.length > 0) appendInline(item, itemText.join(' '));
  };

  let itemText: string[] = [];
  const closeList = (): void => {
    flushItem(itemText);
    itemText = [];
    item = null;
    list = null;
  };

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s{0,3}[-*]\s+(.*)$/.exec(line);
    if (line === '') {
      flushPara();
      // A blank line inside a list doesn't end it; the next non-bullet does.
      continue;
    }
    if (heading) {
      flushPara();
      closeList();
      const h = document.createElement(heading[1]!.length <= 3 ? 'h3' : 'h4');
      appendInline(h, heading[2]!);
      root.append(h);
    } else if (bullet) {
      flushPara();
      flushItem(itemText);
      itemText = [bullet[1]!];
      if (!list) {
        list = document.createElement('ul');
        root.append(list);
      }
      item = document.createElement('li');
      list.append(item);
    } else if (item && /^\s+\S/.test(raw)) {
      itemText.push(line.trim()); // an indented continuation of the bullet
    } else {
      closeList();
      if (!para) {
        para = document.createElement('p');
        root.append(para);
      }
      paraText.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return root;
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

export interface WhatsNewDialogOptions {
  version: string;
  notes: string;
  /** Open a link outside the app. */
  openExternal: (url: string) => void;
}

/** Show the dialog. Resolves when it closes. */
export function showWhatsNewDialog(opts: WhatsNewDialogOptions): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'pmd-confirm-backdrop pmd-whatsnew-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'pmd-confirm pmd-whatsnew';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `What's new in CardMirror ${opts.version}`);

    const title = document.createElement('div');
    title.className = 'pmd-confirm-title pmd-whatsnew-title';
    title.textContent = `What's new in ${opts.version}`;
    dialog.appendChild(title);

    const notes = renderReleaseNotes(opts.notes);
    dialog.appendChild(notes);
    // Links open in the OS browser, not in the app window.
    notes.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement | null)?.closest('a');
      if (!a) return;
      e.preventDefault();
      opts.openExternal(a.href);
    });

    const actions = document.createElement('div');
    actions.className = 'pmd-confirm-actions pmd-whatsnew-actions';
    const pageBtn = document.createElement('button');
    pageBtn.type = 'button';
    pageBtn.className = 'pmd-confirm-btn pmd-confirm-cancel';
    pageBtn.textContent = 'View on GitHub';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'pmd-confirm-btn pmd-confirm-ok';
    okBtn.textContent = 'Got it';
    actions.append(pageBtn, okBtn);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const overlayToken = pushOverlay();
    const restoreFocus = captureFocusForDialog();
    let removeKeys = (): void => {};
    let settled = false;
    const close = (): void => {
      if (settled) return;
      settled = true;
      removeKeys();
      popOverlay(overlayToken);
      backdrop.remove();
      restoreFocus();
      resolve();
    };

    removeKeys = installModalKeys(dialog, overlayToken, (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        close();
        return true;
      }
      return false;
    });

    pageBtn.addEventListener('click', () =>
      opts.openExternal(`${REPO_URL}/releases/tag/v${opts.version}`),
    );
    okBtn.addEventListener('click', close);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close();
    });
    setTimeout(() => okBtn.focus(), 0);
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface MaybeShowDeps {
  version: string;
  fetchNotes?: (version: string) => Promise<string | null>;
  show?: (opts: WhatsNewDialogOptions) => Promise<void>;
  openExternal: (url: string) => void;
  returningInstall?: boolean;
}

function readMarker(): string | null {
  try {
    return localStorage.getItem(MARKER);
  } catch {
    return null;
  }
}

function writeMarker(version: string): void {
  try {
    localStorage.setItem(MARKER, version);
  } catch {
    // Storage unavailable: the notes may repeat next launch, nothing worse.
  }
}

/** Show the notes for `deps.version` if this is the first launch of it. */
export async function maybeShowWhatsNew(deps: MaybeShowDeps): Promise<WhatsNewDecision> {
  const decision = decideWhatsNew({
    stored: readMarker(),
    current: deps.version,
    returningInstall: deps.returningInstall ?? hadSettingsAtLoad,
  });
  if (decision === 'none') return 'none';
  if (decision === 'record') {
    writeMarker(deps.version);
    return 'record';
  }
  const notes = await (deps.fetchNotes ?? fetchReleaseNotes)(deps.version);
  if (notes === null) return 'none'; // try again next launch
  // Mark it seen before showing, so a second window starting at the same
  // moment doesn't stack a second copy.
  writeMarker(deps.version);
  await (deps.show ?? showWhatsNewDialog)({
    version: deps.version,
    notes,
    openExternal: deps.openExternal,
  });
  return 'show';
}

export const __whatsNewMarkerForTests = MARKER;
