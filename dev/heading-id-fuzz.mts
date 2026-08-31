/**
 * Heading-id invariant fuzzer.
 *
 * Purpose-built to produce the field bug family of 2026-08-31: heading
 * nodes with DUPLICATED stable ids (nav misjumps, transclusion
 * ambiguity) or NULL ids (nav-inert ghosts) minted by ordinary editor
 * operations. It drives the editor's REAL command chains — the same
 * ordering index.ts wires (tag-keymap handlers, cross-container
 * delete, type-over-boundary, then ProseMirror's base commands) —
 * because the historical bugs live precisely in the fall-through gaps
 * between our handlers and PM defaults (splitBlock copies attrs;
 * fillBefore synthesizes required tags with default null ids).
 *
 * After EVERY operation it asserts, on the live document:
 *   1. every pocket/hat/block/tag/analytic id is a non-empty string
 *   2. no id appears twice
 *   3. no command threw
 *
 * Run: npx tsx dev/heading-id-fuzz.mts [seeds] [opsPerSeed]
 * Prints one line per finding with the seed + op trace; exits nonzero
 * if anything was found. Once the known bugs are fixed this harness is
 * meant to graduate into the test suite as a permanent fence.
 */
import { EditorState, TextSelection, Selection, Plugin } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import { baseKeymap } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { DOMSerializer, DOMParser as PMDOMParser, Slice } from 'prosemirror-model';
import type { Node as PMNode } from 'prosemirror-model';
import { JSDOM } from 'jsdom';
import { schema, newHeadingId } from '../src/schema/index.js';
import {
  backspaceAtTagStart,
  backspaceAtFirstBodyStart,
  deleteAtTagEnd,
  deleteAtContainerEnd,
  enterMidTag,
  enterAtTagEnd,
  enterInHeading,
  enterAtZoneStart,
} from '../src/editor/tag-keymap.js';
import {
  keepCursorInLeadingBlockOnBlockedMerge,
  blockBackspaceNodeSelect,
  blockDeleteNodeSelect,
} from '../src/editor/boundary-cursor-keymap.js';
import {
  typeOverBoundaryPlugin,
  crossContainerDeleteSelection,
} from '../src/editor/type-over-boundary.js';
import { freshHeadingIds } from '../src/editor/drag-controller.js';

// jsdom globals for DOMSerializer/DOMParser work.
const dom = new JSDOM('<html><body></body></html>');
(globalThis as Record<string, unknown>)['document'] = dom.window.document;
(globalThis as Record<string, unknown>)['window'] = dom.window;

// ── PRNG ─────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(rng: () => number, xs: T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

// ── Random doc ───────────────────────────────────────────────────────
const n = schema.nodes;
const WORDS = ['deter', 'japan', 'alliance', 'turn', 'sust', 'frame', 'link', 'uq'];
function text(rng: () => number): string {
  return Array.from({ length: int(rng, 1, 4) }, () => pick(rng, WORDS)).join(' ');
}
function genDoc(rng: () => number): PMNode {
  const kids: PMNode[] = [];
  const count = int(rng, 3, 8);
  for (let i = 0; i < count; i++) {
    switch (int(rng, 0, 4)) {
      case 0:
        kids.push(n['block']!.create({ id: newHeadingId() }, schema.text(text(rng))));
        break;
      case 1:
        kids.push(n['hat']!.create({ id: newHeadingId() }, schema.text(text(rng))));
        break;
      case 2:
        kids.push(n['card']!.createChecked(null, [
          n['tag']!.create({ id: newHeadingId() }, schema.text(text(rng))),
          n['card_body']!.create(null, schema.text(text(rng))),
        ]));
        break;
      case 3:
        kids.push(n['analytic_unit']!.createChecked(null, [
          n['analytic']!.create({ id: newHeadingId() }, schema.text(text(rng))),
          n['card_body']!.create(null, schema.text(text(rng))),
        ]));
        break;
      default:
        kids.push(n['paragraph']!.create(null, schema.text(text(rng))));
    }
  }
  return n['doc']!.createChecked(null, kids);
}

// ── The real chains (mirroring index.ts wiring order) ───────────────
const enterChain: Command[] = [
  enterAtTagEnd, enterAtZoneStart, enterMidTag, enterInHeading, baseKeymap['Enter']!,
];
const backspaceChain: Command[] = [
  crossContainerDeleteSelection, backspaceAtTagStart, backspaceAtFirstBodyStart,
  keepCursorInLeadingBlockOnBlockedMerge, blockBackspaceNodeSelect, baseKeymap['Backspace']!,
];
const deleteChain: Command[] = [
  crossContainerDeleteSelection, deleteAtTagEnd, deleteAtContainerEnd,
  keepCursorInLeadingBlockOnBlockedMerge, blockDeleteNodeSelect, baseKeymap['Delete']!,
];

// ── Invariant scan ───────────────────────────────────────────────────
const HEAD = new Set(['pocket', 'hat', 'block', 'tag', 'analytic']);
function scanInvariants(doc: PMNode): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  doc.descendants((node) => {
    if (!HEAD.has(node.type.name)) return true;
    const id = node.attrs['id'];
    const label = `${node.type.name}:"${node.textContent.slice(0, 24)}"`;
    if (typeof id !== 'string' || !id) {
      problems.push(`NULL-ID ${label}`);
      return true;
    }
    const prior = seen.get(id);
    if (prior) problems.push(`DUP-ID ${id.slice(0, 8)} on ${prior} and ${label}`);
    else seen.set(id, label);
    return true;
  });
  return problems;
}

// ── Fuzz loop ────────────────────────────────────────────────────────
const seeds = Number(process.argv[2] ?? 60);
const opsPerSeed = Number(process.argv[3] ?? 50);
let findings = 0;
const findingKinds = new Map<string, number>();

for (let seed = 1; seed <= seeds; seed++) {
  const rng = mulberry32(seed);
  let state = EditorState.create({
    doc: genDoc(rng),
    plugins: [history(), typeOverBoundaryPlugin],
  });
  const trace: string[] = [];
  const dispatch = (tr: Transaction): void => { state = state.apply(tr); };
  const view = {
    get state() { return state; },
    dispatch,
    // Enough of EditorView for the base commands' cursor probes: no
    // rendered DOM here, so directional textblock-edge answers are a
    // conservative false (commands then use position math).
    endOfTextblock: () => false,
  } as never;
  const randomPos = (): number => int(rng, 1, Math.max(1, state.doc.content.size - 1));
  const setSel = (from: number, to: number): boolean => {
    try {
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, Math.min(from, to), Math.max(from, to))));
      return true;
    } catch { return false; }
  };
  const setNear = (pos: number): void => {
    state = state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(Math.min(pos, state.doc.content.size)))));
  };

  for (let op = 0; op < opsPerSeed; op++) {
    const kind = pick(rng, ['enter', 'enter', 'type', 'type', 'backspace', 'delete', 'paste', 'undo', 'redo']);
    let opLabel = kind;
    try {
      if (kind === 'enter') {
        setNear(randomPos());
        opLabel = `enter@${state.selection.from}`;
        for (const c of enterChain) if (c(state, dispatch, view)) break;
      } else if (kind === 'backspace' || kind === 'delete') {
        const a = randomPos();
        const useRange = rng() < 0.6;
        if (useRange) { if (!setSel(a, a + int(rng, 1, 40))) continue; }
        else setNear(a);
        opLabel = `${kind}@${state.selection.from}-${state.selection.to}`;
        const chain = kind === 'backspace' ? backspaceChain : deleteChain;
        for (const c of chain) if (c(state, dispatch, view)) break;
      } else if (kind === 'type') {
        const a = randomPos();
        const ranged = rng() < 0.5;
        const b = ranged ? Math.min(a + int(rng, 1, 40), state.doc.content.size - 1) : a;
        if (!setSel(a, b)) continue;
        const { from, to } = state.selection;
        opLabel = `type@${from}-${to}`;
        const handler = typeOverBoundaryPlugin.props.handleTextInput! as (
          v: never, f: number, t: number, s: string,
        ) => boolean;
        if (!handler(view, from, to, 'x')) {
          // PM's default input path.
          dispatch(state.tr.insertText('x', from, to));
        }
      } else if (kind === 'paste') {
        // Copy a random range through the clipboard's HTML round-trip
        // (data-id is NOT serialized by our toDOM parse rules' getAttrs,
        // mirroring the real clipboard), re-id via the paste pipeline's
        // freshHeadingIds, and replaceSelection at a random spot.
        const a = randomPos(); const b = Math.min(a + int(rng, 2, 120), state.doc.content.size - 1);
        if (a >= b) continue;
        const slice = state.doc.slice(a, b);
        const holder = dom.window.document.createElement('div');
        holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(slice.content, { document: dom.window.document }));
        const parsed = PMDOMParser.fromSchema(schema).parseSlice(holder, { preserveWhitespace: 'full' });
        const reids = freshHeadingIds(new Slice(parsed.content, slice.openStart, slice.openEnd));
        setNear(randomPos());
        opLabel = `paste[${a}-${b}]@${state.selection.from}`;
        dispatch(state.tr.replaceSelection(reids));
      } else if (kind === 'undo') {
        undo(state, dispatch);
      } else {
        redo(state, dispatch);
      }
    } catch (err) {
      findings++;
      const key = `THROW: ${(err as Error).message.slice(0, 60)}`;
      findingKinds.set(key, (findingKinds.get(key) ?? 0) + 1);
      console.log(`seed ${seed} op#${op} [${opLabel}] THREW: ${(err as Error).message}`);
      console.log(`  trace: ${trace.slice(-6).join(' → ')}`);
      break;
    }
    trace.push(opLabel);
    const problems = scanInvariants(state.doc);
    if (problems.length) {
      findings++;
      for (const p of problems) {
        const key = p.split(' ')[0]! + ' via ' + kind;
        findingKinds.set(key, (findingKinds.get(key) ?? 0) + 1);
      }
      console.log(`seed ${seed} op#${op} [${opLabel}]: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}`);
      console.log(`  trace: ${trace.slice(-6).join(' → ')}`);
      break; // one finding per seed keeps output readable
    }
  }
}
console.log(`\n${findings} finding(s) across ${seeds} seeds × ${opsPerSeed} ops`);
for (const [k, v] of [...findingKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`);
process.exit(findings ? 1 : 0);
