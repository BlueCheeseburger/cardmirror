/**
 * Reading view — Word-style paginated columns for reading a speech
 * doc aloud (field request, 2026-08-31; design settled in the Ella
 * Fulkerson thread + follow-ups).
 *
 * Layout: the live ProseMirror element becomes a height-capped CSS
 * multicolumn strip (`column-fill: auto`), so content flows into as
 * many columns as it needs, overflowing HORIZONTALLY. The viewport
 * shows `count` columns (1–3, derived from PANE width and the
 * accessibility text-width cap) and a page flip is a pure compositor
 * `translateX` of the pre-laid-out strip — the whole document is
 * already rendered on both sides of the visible page, which is what
 * makes the animation hitch-proof (no layout, no paint during the
 * transition; `content-visibility` is forced ON inside the strip so
 * column math is exact). Word semantics throughout: full-screen
 * replacement flips (the "option A" answer), line-granularity column
 * breaks with tags/cites kept with their first body line (CSS
 * break-after), nav clicks land on the containing page.
 *
 * Interaction: ←/→, PgUp/PgDn, Space/Shift-Space flip; Home/End jump;
 * one wheel detent = one flip (trackpad deltas accumulate to a
 * threshold with a cooldown so a swipe is ONE flip); Word-style edge
 * click zones; a subtle page indicator. ↑/↓ are left to ProseMirror —
 * the caret stays placeable for the reading-marker affordance.
 *
 * Editing: locked to exactly the reading-marker edits (same
 * allowances as read mode's filter) — WITHOUT read mode's drag
 * exception: no drag affordance exists here at all. Combinable with
 * read mode (invisibility): both plugins' filters and classes stack.
 *
 * State: per-doc, session-only — a `rec.readerView` field in the
 * multi-pane shell (same per-doc story as `rec.readMode`) and a
 * module flag in single-doc. Deliberately NOT a setting: closing and
 * reopening a doc lands in the normal editor.
 *
 * Live changes (a marker lands, collab edits arrive): the plugin
 * view schedules an anchored relayout — the first visible position
 * is pinned, the strip re-measures, and the page containing the
 * anchor becomes current without animation. Relayout is deferred
 * while a flip animation is in flight (the no-hitch rule).
 */

import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { settings } from './settings.js';
import { isSyncOrigin } from './sync-origin.js';
import { NORMALIZER_META } from './normalizer-guard.js';
import { READING_MARKER_META, READ_MODE_UNDO_META } from './reading-marker.js';

export const PMD_READER_VIEW_TOGGLE = 'pmdReaderViewToggle';

const readerKey = new PluginKey<{ on: boolean }>('pmd-reader-view');

export const readerViewPlugin: Plugin<{ on: boolean }> = new Plugin<{ on: boolean }>({
  key: readerKey,
  state: {
    init: () => ({ on: false }),
    apply(tr, prev) {
      const meta = tr.getMeta(PMD_READER_VIEW_TOGGLE);
      return meta === undefined ? prev : { on: meta === true };
    },
  },
  // Reading view locks the doc to reading-marker edits only. Same
  // allowance set as read mode's filter MINUS the drag exception —
  // the drag affordance doesn't exist in this view. Sync-origin and
  // normalizer transactions pass for the same reasons documented in
  // read-mode-plugin.ts.
  filterTransaction(tr, state) {
    if (!readerKey.getState(state)?.on) return true;
    if (!tr.docChanged) return true;
    return (
      isSyncOrigin(tr) ||
      tr.getMeta(NORMALIZER_META) === true ||
      tr.getMeta(READING_MARKER_META) === true ||
      tr.getMeta(READ_MODE_UNDO_META) === true
    );
  },
  view() {
    return {
      update(view, prevState) {
        // Only CONTENT changes need a relayout (a marker, a remote
        // edit). Selection-only updates fire on every caret move —
        // relayouting on those made each keypress pay a double
        // full-document layout before anything flipped (field
        // report: "huge pause before anything happens").
        if (view.state.doc !== prevState.doc) {
          controllers.get(view)?.scheduleRelayout();
        }
      },
    };
  },
});

export function readerViewActive(view: EditorView): boolean {
  return readerKey.getState(view.state)?.on === true;
}

// ── Pure layout math (unit-tested) ───────────────────────────────────

export interface ReaderLayout {
  count: number;
  colW: number;
  gap: number;
  /** Horizontal distance of one full-page flip. */
  stride: number;
}

export const READER_GAP = 48;
/** Width of the reserved edge flip lanes (px, host space). */
export const READER_EDGE_W = 40;
/** Comfortable reading column when no accessibility cap is set. */
export const READER_IDEAL_COL = 560;
export const READER_MIN_COL = 280;

/** Column plan for a pane `paneW` px wide. `capPx` is the
 *  accessibility max-text-width (0 = unset). Word-like: as many
 *  ideal-width columns as fit, clamped 1..3; the columns then share
 *  the pane. */
export function computeReaderLayout(paneW: number, capPx: number): ReaderLayout {
  const cap = capPx > 0 ? Math.max(READER_MIN_COL, capPx) : 0;
  const ideal = cap || READER_IDEAL_COL;
  const usable = Math.max(READER_MIN_COL, paneW - READER_GAP * 2);
  const count = Math.max(1, Math.min(3, Math.floor((usable + READER_GAP) / (ideal + READER_GAP))));
  let colW = Math.floor((usable - READER_GAP * (count - 1)) / count);
  // The accessibility cap is a hard MAX text width — a wide pane with
  // few columns must not stretch lines past it (leftover width
  // becomes outer margin, centered by the host).
  if (cap) colW = Math.min(colW, cap);
  return { count, colW, gap: READER_GAP, stride: count * (colW + READER_GAP) };
}

export function pageCount(stripWidth: number, stride: number): number {
  return Math.max(1, Math.ceil(stripWidth / Math.max(1, stride)));
}

/** Which page a strip-local x offset lives on. */
export function pageOfOffset(x: number, stride: number): number {
  return Math.max(0, Math.floor(x / Math.max(1, stride)));
}

/** Wheel-input accumulator: discrete detents flip immediately;
 *  trackpad streams accumulate to a threshold. A cooldown after each
 *  flip makes one swipe one flip. Pure — timestamps injected. */
export class WheelPager {
  private acc = 0;
  private coolUntil = 0;
  constructor(
    private readonly threshold = 90,
    private readonly cooldownMs = 220,
  ) {}
  /** Returns -1 / 0 / +1 pages for this wheel event. */
  feed(delta: number, now: number): number {
    if (now < this.coolUntil) return 0;
    // A classic wheel detent reports large per-event deltas — flip at
    // once. Trackpads stream small deltas — accumulate.
    this.acc += delta;
    if (Math.abs(this.acc) < this.threshold) return 0;
    const dir = this.acc > 0 ? 1 : -1;
    this.acc = 0;
    this.coolUntil = now + this.cooldownMs;
    return dir;
  }
}

// ── Controller (DOM; exercised via the dev build) ────────────────────

const controllers = new WeakMap<EditorView, ReaderController>();

export function readerControllerFor(view: EditorView): ReaderController | null {
  return controllers.get(view) ?? null;
}

/** Nearest scrolling ancestor — the element whose viewport caps the
 *  strip height (single-doc #app, a pane's body). Local copy rather
 *  than importing precise-scroll's (that module imports us). */
function nearestScrollerOf(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const cs = getComputedStyle(cur);
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return cur;
    cur = cur.parentElement;
  }
  return null;
}

function motionReduced(): boolean {
  if (settings.get('readerReduceMotion')) return true;
  const pref = settings.get('reduceMotion');
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export class ReaderController {
  private layout: ReaderLayout = { count: 1, colW: 0, gap: READER_GAP, stride: 1 };
  private page = 0;
  private pages = 1;
  private relayoutQueued = false;
  private stripExtent = 0;
  private animating = false;
  private relayoutAfterAnim = false;
  private readonly pager = new WheelPager();
  private leftGutter!: HTMLElement;
  private rightGutter!: HTMLElement;
  private readonly leftBtn: HTMLButtonElement;
  private readonly rightBtn: HTMLButtonElement;
  private readonly indicator: HTMLElement;
  private readonly resizeObs: ResizeObserver | null;
  private readonly offKey: () => void;
  private readonly offWheel: () => void;
  private readonly offEnd: () => void;

  constructor(
    private readonly host: HTMLElement,
    private readonly view: EditorView,
  ) {
    const mk = (cls: string, label: string, dir: 1 | -1): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pmd-reader-edge ${cls}`;
      b.setAttribute('aria-label', label);
      b.textContent = dir > 0 ? '›' : '‹';
      b.addEventListener('click', () => this.flip(dir));
      host.appendChild(b);
      return b;
    };
    this.leftGutter = document.createElement('div');
    this.leftGutter.className = 'pmd-reader-gutter';
    this.rightGutter = document.createElement('div');
    this.rightGutter.className = 'pmd-reader-gutter';
    host.appendChild(this.leftGutter);
    host.appendChild(this.rightGutter);
    this.leftBtn = mk('pmd-reader-edge-left', 'Previous page', -1);
    this.rightBtn = mk('pmd-reader-edge-right', 'Next page', 1);
    this.indicator = document.createElement('div');
    this.indicator.className = 'pmd-reader-page-indicator';
    host.appendChild(this.indicator);

    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) {
        e.preventDefault();
        this.flip(1);
      } else if (k === 'ArrowLeft' || k === 'PageUp' || (k === ' ' && e.shiftKey)) {
        e.preventDefault();
        this.flip(-1);
      } else if (k === 'Home') {
        e.preventDefault();
        this.goTo(0);
      } else if (k === 'End') {
        e.preventDefault();
        this.goTo(this.pages - 1);
      }
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault(); // no native scrolling in a paginated view
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      const dir = this.pager.feed(delta, performance.now());
      if (dir) this.flip(dir);
    };
    // CAPTURE phase: the flip keys must never reach ProseMirror —
    // in bubble order PM sees them first, moves the caret, and the
    // resulting churn delays the flip.
    const onKeyCapture = (e: KeyboardEvent): void => {
      onKey(e);
      if (e.defaultPrevented) e.stopPropagation();
    };
    host.addEventListener('keydown', onKeyCapture, true);
    host.addEventListener('wheel', onWheel, { passive: false });
    this.offKey = () => host.removeEventListener('keydown', onKeyCapture, true);
    this.offWheel = () => host.removeEventListener('wheel', onWheel);

    const strip = this.strip();
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== 'transform') return;
      this.animating = false;
      if (this.relayoutAfterAnim) {
        this.relayoutAfterAnim = false;
        this.relayout();
      }
    };
    strip?.addEventListener('transitionend', onEnd);
    this.offEnd = () => strip?.removeEventListener('transitionend', onEnd);

    this.resizeObs =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => this.scheduleRelayout())
        : null;
    this.resizeObs?.observe(host);
    this.relayout();
  }

  dispose(): void {
    this.leftGutter.remove();
    this.rightGutter.remove();
    this.offKey();
    this.offWheel();
    this.offEnd();
    this.resizeObs?.disconnect();
    this.leftBtn.remove();
    this.rightBtn.remove();
    this.indicator.remove();
    const strip = this.strip();
    if (strip) {
      strip.style.removeProperty('transform');
      strip.style.removeProperty('transition');
      strip.style.removeProperty('margin-left');
      strip.style.removeProperty('margin-right');
      for (const p of [
        '--pmd-reader-cols', '--pmd-reader-page-w',
        '--pmd-reader-gap', '--pmd-reader-h',
      ]) {
        strip.style.removeProperty(p);
      }
    }
  }

  private strip(): HTMLElement | null {
    return this.host.querySelector<HTMLElement>('.ProseMirror');
  }

  /** Anchor = leftmost strip offset currently in view; used to keep
   *  the reader's place across relayouts. */
  private currentOffset(): number {
    return this.page * this.layout.stride;
  }

  scheduleRelayout(): void {
    if (this.animating) {
      this.relayoutAfterAnim = true;
      return;
    }
    if (this.relayoutQueued) return;
    this.relayoutQueued = true;
    requestAnimationFrame(() => {
      this.relayoutQueued = false;
      this.relayout();
    });
  }

  relayout(): void {
    const strip = this.strip();
    if (!strip) return;
    // Pin the current place as a strip-fraction before re-measuring —
    // column widths change, but the doc's linear order doesn't. The
    // previous extent comes from our own measurement (scrollWidth
    // ignores multicol overflow columns).
    const frac = this.stripExtent > 0 ? this.currentOffset() / this.stripExtent : 0;
    // Page geometry is PURE MATH from clientWidth + the text-width
    // settings — the earlier strip-the-class-and-measure approach
    // forced two full-document layouts per relayout AND let #app keep
    // a stale scrollTop from the momentary full-height doc, scrolling
    // the viewport past the short strip (field report: marker drop
    // whited out the screen).
    const available = Math.max(READER_MIN_COL, this.host.clientWidth);
    const cap = settings.get('maxTextWidthPx');
    const pageW = cap > 0 ? Math.min(Math.max(READER_MIN_COL, cap), available) : available;
    const extra = Math.max(0, available - pageW);
    const align = settings.get('maxTextWidthAlign');
    const clipL = align === 'left' ? 0 : align === 'right' ? extra : Math.round(extra / 2);
    const clipR = extra - clipL;
    // Clip the host to exactly the page window: the strip's overflow
    // columns otherwise bleed into the margins at idle. The edge flip
    // zones move inside the window with it.
    this.host.style.clipPath = `inset(0 ${clipR}px 0 ${clipL}px)`;
    this.leftBtn.style.left = `${clipL}px`;
    this.rightBtn.style.right = `${clipR}px`;
    // Height = the SCROLLER's viewport (never the host's natural
    // height), divided by the #editor zoom (the strip lays out in
    // zoomed coordinate space; the scroller sits outside it). Any
    // stray scroll would show blank space past the short strip — pin.
    const scroller = nearestScrollerOf(this.host);
    if (scroller) scroller.scrollTop = 0;
    const viewH = Math.max(
      120,
      Math.floor(((scroller?.clientHeight ?? window.innerHeight) - 8) / this.zoomFactor()),
    );
    this.layout = computeReaderLayout(pageW + READER_GAP * 2, settings.get('maxTextWidthPx'));
    // Exact column geometry from the REAL page width: the box is one
    // page wide, column-count divides it exactly, and overflow columns
    // continue at the same pitch — one page stride = pageW + gap,
    // always matching the rendered columns (column-count, never the
    // column-width hint, whose browser-chosen widths drift).
    const count = this.layout.count;
    const colW = Math.floor((pageW - READER_GAP * (count - 1)) / count);
    this.layout = { count, colW, gap: READER_GAP, stride: pageW + READER_GAP };
    strip.style.setProperty('--pmd-reader-cols', String(count));
    strip.style.setProperty('--pmd-reader-page-w', `${pageW}px`);
    strip.style.setProperty('--pmd-reader-gap', `${READER_GAP}px`);
    strip.style.setProperty('--pmd-reader-h', `${viewH}px`);
    const stripW = this.measureStripExtent(strip);
    this.stripExtent = stripW;
    this.pages = pageCount(stripW, this.layout.stride);
    this.goTo(pageOfOffset(frac * stripW, this.layout.stride), { animate: false });
  }

  /** Total strip extent including the multicol OVERFLOW columns —
   *  which `scrollWidth` does NOT report on a plain element (field
   *  bug: a 60-page doc read "1 / 1" and flips went nowhere). The
   *  last DOM children sit in the last column (document order =
   *  column order), so the max right edge over the tail children is
   *  the strip's true content extent. Rects are visual px: undo the
   *  current translate and the #editor zoom factor. */
  private measureStripExtent(strip: HTMLElement): number {
    const zoom = this.zoomFactor();
    const stripRect = strip.getBoundingClientRect();
    const translated = this.currentTranslateX() * zoom;
    const baseLeft = stripRect.left - translated;
    let maxRight = stripRect.right - translated;
    const kids = strip.children;
    for (let i = Math.max(0, kids.length - 8); i < kids.length; i++) {
      const r = kids[i]!.getBoundingClientRect();
      if (r.right - translated > maxRight) maxRight = r.right - translated;
    }
    return Math.max(1, (maxRight - baseLeft) / zoom);
  }

  private currentTranslateX(): number {
    const raw = this.strip()?.style.transform ?? '';
    const m = /translateX\((-?[\d.]+)px\)/.exec(raw);
    return m ? parseFloat(m[1]!) : 0;
  }

  /** `#editor { zoom: var(--editor-zoom) }` scales rects; CSS lengths
   *  we set are pre-zoom. */
  private zoomFactor(): number {
    const z = parseFloat(getComputedStyle(this.host).zoom || '1');
    return Number.isFinite(z) && z > 0 ? z : 1;
  }

  flip(dir: number): void {
    this.goTo(this.page + dir);
  }

  goTo(page: number, opts: { animate?: boolean } = {}): void {
    const strip = this.strip();
    if (!strip) return;
    const clamped = Math.max(0, Math.min(this.pages - 1, page));
    const animate = (opts.animate ?? true) && !motionReduced() && clamped !== this.page;
    this.page = clamped;
    // Inline transform, NEVER a custom property: custom props inherit,
    // so touching one on the strip invalidates style for the whole
    // multi-thousand-node subtree — a long pause before every flip
    // (field report). An inline transform recalcs one element and
    // goes straight to the compositor.
    strip.style.transition = animate ? '' : 'none';
    if (animate) this.animating = true;
    strip.style.transform = `translateX(${-clamped * this.layout.stride}px)`;
    if (!animate) this.animating = false;
    this.leftBtn.classList.toggle('pmd-reader-edge-hidden', clamped === 0);
    this.rightBtn.classList.toggle('pmd-reader-edge-hidden', clamped >= this.pages - 1);
    this.indicator.textContent = `${clamped + 1} / ${this.pages}`;
  }

  /** Jump so `el` (a heading the nav clicked, a find hit) is on
   *  screen: land on the page containing its strip offset. */
  goToElement(el: HTMLElement): void {
    const strip = this.strip();
    if (!strip) return;
    const stripLeft = strip.getBoundingClientRect().left;
    const offset = el.getBoundingClientRect().left - stripLeft;
    this.goTo(pageOfOffset(offset, this.layout.stride), { animate: false });
  }

  goToPos(pos: number): void {
    try {
      const dom = this.view.domAtPos(pos);
      let el: Node | null = dom.node;
      while (el && el.nodeType !== Node.ELEMENT_NODE) el = el.parentNode;
      if (el instanceof HTMLElement) this.goToElement(el);
    } catch {
      /* stale pos — stay put */
    }
  }
}

// ── Apply / toggle (mirrors applyReadModeToTarget's shape) ───────────

/** Enter/exit reading view on a specific editor surface. Per-doc:
 *  the multi-pane shell calls this per pane record; single-doc goes
 *  through the module flag in index.ts. */
export function applyReaderViewToTarget(
  hostEl: HTMLElement,
  targetView: EditorView,
  on: boolean,
): void {
  hostEl.classList.toggle('pmd-reader-view', on);
  const existing = controllers.get(targetView);
  if (on && !existing) {
    controllers.set(targetView, new ReaderController(hostEl, targetView));
  } else if (!on && existing) {
    existing.dispose();
    controllers.delete(targetView);
  }
  // Caret stays placeable (marker drops); edits are blocked by the
  // plugin's filterTransaction.
  targetView.setProps({ editable: () => true });
  targetView.dispatch(targetView.state.tr.setMeta(PMD_READER_VIEW_TOGGLE, on));
}
