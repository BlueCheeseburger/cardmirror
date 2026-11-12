/**
 * The release-notes card on the update chip. Hovering (or focusing) the chip
 * while an update is ready or available shows a small card above it with the
 * headlines of that release's notes, so you can decide whether you want the
 * update before you click to install. It reuses the What's new popup's fetch
 * and dialog: "Read the full notes…" opens that dialog.
 *
 * Quiet by design: nothing shows for a download in progress or a plugin
 * update, a failed fetch says so and links to the release page, and the notes
 * of a version are fetched once (a failure is not remembered, so the next
 * hover tries again).
 */

import { fetchReleaseNotes, releasePageUrl, showWhatsNewDialog } from './whats-new.js';

export interface NoteSection {
  title: string;
  items: string[];
}

export interface NotesSummary {
  sections: NoteSection[];
  /** Bullets left out of `sections` by the per-section and overall limits. */
  more: number;
}

const MAX_PER_SECTION = 3;
const MAX_TOTAL = 6;
const MAX_ITEM_CHARS = 110;

/** Plain text of a markdown fragment: code spans, bold and links unwrapped. */
function plain(md: string): string {
  return md
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One bullet's headline: its bold lead sentence (the changelog style), else
 *  its first sentence, shortened. */
function headline(bullet: string): string {
  const bold = /^\*\*(.+?)\*\*/.exec(bullet);
  let text = plain(bold ? bold[1]! : bullet);
  if (!bold) {
    const dot = text.search(/[.!?](\s|$)/);
    if (dot > 0) text = text.slice(0, dot + 1);
  }
  if (text.length > MAX_ITEM_CHARS) text = `${text.slice(0, MAX_ITEM_CHARS - 1).trimEnd()}…`;
  return text;
}

/** The notes reduced to headlines: `###` sections and one line per bullet,
 *  capped per section and overall (the rest counted in `more`). Pure. */
export function summarizeReleaseNotes(markdown: string): NotesSummary {
  const raw: NoteSection[] = [];
  let cur: NoteSection | null = null;
  let bullet: string[] | null = null;
  const flush = (): void => {
    if (bullet && cur) {
      const h = headline(bullet.join(' ').trim());
      if (h) cur.items.push(h);
    }
    bullet = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const head = /^#{2,4}\s+(.+?)\s*#*$/.exec(line);
    if (head) {
      flush();
      cur = { title: plain(head[1]!), items: [] };
      raw.push(cur);
      continue;
    }
    const b = /^\s{0,3}[-*]\s+(.*)$/.exec(line);
    if (b) {
      flush();
      if (!cur) {
        cur = { title: '', items: [] };
        raw.push(cur);
      }
      bullet = [b[1]!];
      continue;
    }
    if (bullet && /^\s+\S/.test(line)) bullet.push(line.trim());
    else if (line.trim() === '') flush();
  }
  flush();

  const sections: NoteSection[] = [];
  let used = 0;
  let more = 0;
  for (const sec of raw) {
    if (sec.items.length === 0) continue;
    const room = Math.max(0, Math.min(MAX_PER_SECTION, MAX_TOTAL - used));
    const keep = sec.items.slice(0, room);
    more += sec.items.length - keep.length;
    used += keep.length;
    if (keep.length > 0) sections.push({ title: sec.title, items: keep });
  }
  return { sections, more };
}

export interface UpdateNotesCardDeps {
  /** The version the chip is offering, or null when the card should not show
   *  (no update, a download in progress, a plugin update). */
  getVersion(): string | null;
  /** What clicking the chip does, for the card's footer: "install" or "download". */
  getAction(): 'install' | 'download';
  openExternal?(url: string): void | Promise<void>;
  /** Overridable for tests. */
  fetchNotes?(version: string): Promise<string | null>;
  showDialog?: typeof showWhatsNewDialog;
}

const SHOW_DELAY_MS = 350;
const HIDE_DELAY_MS = 250;

/** Wire the card to a chip button. Returns a disposer. */
export function attachUpdateNotesCard(chip: HTMLElement, deps: UpdateNotesCardDeps): () => void {
  const fetchNotes = deps.fetchNotes ?? fetchReleaseNotes;
  const showDialog = deps.showDialog ?? showWhatsNewDialog;
  const cache = new Map<string, Promise<string | null>>();
  let card: HTMLElement | null = null;
  let showTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let shownFor = '';

  const clearTimers = (): void => {
    if (showTimer) clearTimeout(showTimer);
    if (hideTimer) clearTimeout(hideTimer);
    showTimer = hideTimer = null;
  };
  const hide = (): void => {
    clearTimers();
    card?.remove();
    card = null;
    shownFor = '';
  };
  const scheduleHide = (): void => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  };
  const openExternal = (url: string): void => {
    void Promise.resolve(deps.openExternal?.(url)).catch((err) => console.warn('openExternal failed:', err));
  };

  const place = (): void => {
    if (!card) return;
    const r = chip.getBoundingClientRect();
    const w = card.getBoundingClientRect().width || 380;
    card.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    card.style.bottom = `${window.innerHeight - r.top + 6}px`;
  };

  const fill = (version: string, notes: string | null | undefined): void => {
    if (!card) return;
    card.replaceChildren();
    const title = document.createElement('div');
    title.className = 'pmd-update-notes-title';
    title.textContent = `What's new in ${version}`;
    card.appendChild(title);

    const body = document.createElement('div');
    body.className = 'pmd-update-notes-body';
    card.appendChild(body);
    const foot = document.createElement('div');
    foot.className = 'pmd-update-notes-foot';
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'pmd-update-notes-link';
    const hint = document.createElement('span');
    hint.className = 'pmd-update-notes-hint';
    hint.textContent = deps.getAction() === 'install' ? 'Click the chip to install' : 'Click the chip to download';
    foot.append(link, hint);
    card.appendChild(foot);

    if (notes === undefined) {
      body.textContent = 'Loading release notes…';
      link.textContent = 'View on GitHub';
      link.addEventListener('click', () => openExternal(releasePageUrl(version)));
    } else if (notes === null) {
      body.textContent = "The release notes couldn't be loaded.";
      link.textContent = 'View on GitHub';
      link.addEventListener('click', () => openExternal(releasePageUrl(version)));
    } else {
      const { sections, more } = summarizeReleaseNotes(notes);
      for (const sec of sections) {
        if (sec.title) {
          const h = document.createElement('div');
          h.className = 'pmd-update-notes-section';
          h.textContent = sec.title;
          body.appendChild(h);
        }
        const ul = document.createElement('ul');
        for (const item of sec.items) {
          const li = document.createElement('li');
          li.textContent = item;
          ul.appendChild(li);
        }
        body.appendChild(ul);
      }
      if (sections.length === 0) body.textContent = 'See the full notes for what changed.';
      if (more > 0) {
        const m = document.createElement('div');
        m.className = 'pmd-update-notes-more';
        m.textContent = `+ ${more} more in the full notes`;
        body.appendChild(m);
      }
      link.textContent = 'Read the full notes…';
      link.addEventListener('click', () => {
        hide();
        void showDialog({ version, notes, openExternal });
      });
    }
    place();
  };

  const show = (): void => {
    showTimer = null;
    const version = deps.getVersion();
    if (!version || chip.hidden) return;
    if (card && shownFor === version) return;
    hide();
    shownFor = version;
    card = document.createElement('div');
    card.className = 'pmd-update-notes';
    card.setAttribute('role', 'tooltip');
    card.addEventListener('mouseenter', () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
    });
    card.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(card);
    fill(version, undefined);
    let p = cache.get(version);
    if (!p) {
      p = fetchNotes(version).catch(() => null);
      cache.set(version, p);
    }
    void p.then((notes) => {
      if (notes === null) cache.delete(version); // try again on the next hover
      if (card && shownFor === version) fill(version, notes);
    });
  };

  const arm = (): void => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    if (card || showTimer) return;
    showTimer = setTimeout(show, SHOW_DELAY_MS);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && card) hide();
  };

  chip.addEventListener('mouseenter', arm);
  chip.addEventListener('mouseleave', scheduleHide);
  chip.addEventListener('focus', arm);
  chip.addEventListener('blur', scheduleHide);
  chip.addEventListener('pointerdown', hide);
  chip.addEventListener('keydown', onKey);
  return () => {
    hide();
    chip.removeEventListener('mouseenter', arm);
    chip.removeEventListener('mouseleave', scheduleHide);
    chip.removeEventListener('focus', arm);
    chip.removeEventListener('blur', scheduleHide);
    chip.removeEventListener('pointerdown', hide);
    chip.removeEventListener('keydown', onKey);
  };
}
