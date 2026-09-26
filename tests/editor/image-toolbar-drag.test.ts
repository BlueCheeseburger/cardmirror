// @vitest-environment jsdom

/**
 * Google Docs-style images (fork): proportional-only handles, the
 * toolbar under a selected image, image-file drops, fitting big images
 * to the page width, and the dragstart carve-out that lets an image be
 * moved while text drags stay blocked.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { EditorState, NodeSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema/index.js';

vi.mock('../../src/editor/toast.js', () => ({ showToast: vi.fn() }));

import { editorNodeViews, proportionalResize } from '../../src/editor/image-resize-nodeview.js';
import { fitToColumn, insertImageNodesAt, TEXT_COLUMN_PX } from '../../src/editor/image-insert.js';
import { allowImageDragStart, imageDropPlugin } from '../../src/editor/image-drop-plugin.js';

const EMU = 9525;

function image(wPx: number, hPx: number): PMNode {
  return schema.nodes['image']!.create({
    data: 'AAAA',
    contentType: 'image/png',
    widthEmu: wPx * EMU,
    heightEmu: hPx * EMU,
    alt: 'old',
  });
}

function setup(...inline: PMNode[]) {
  const para = schema.nodes['paragraph']!.create(null, [schema.text('ab'), ...inline, schema.text('cd')]);
  const doc = schema.nodes['doc']!.create(null, [para]);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const view = new EditorView(container, {
    state: EditorState.create({ doc, plugins: [imageDropPlugin] }),
    nodeViews: editorNodeViews,
  });
  return view;
}

/** Position of the first image in the doc. */
function imagePos(view: EditorView): number {
  let at = -1;
  view.state.doc.descendants((n, pos) => {
    if (at < 0 && n.type.name === 'image') at = pos;
    return at < 0;
  });
  return at;
}

function select(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imagePos(view))));
}

/** Fake the <img>'s decoded size (jsdom never decodes). */
function setNatural(view: EditorView, w: number, h: number): void {
  const img = view.dom.querySelector<HTMLImageElement>('img[data-pmd-image]')!;
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: w });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: h });
}

const buttons = (view: EditorView): HTMLButtonElement[] => [
  ...view.dom.querySelectorAll<HTMLButtonElement>('.pmd-image-toolbar-btn'),
];
const button = (view: EditorView, label: string): HTMLButtonElement => {
  const b = buttons(view).find((x) => x.textContent === label);
  if (!b) throw new Error(`no "${label}" button`);
  return b;
};
const sizePx = (view: EditorView): [number, number] => {
  const n = view.state.doc.nodeAt(imagePos(view))!;
  return [Math.round(n.attrs['widthEmu'] / EMU), Math.round(n.attrs['heightEmu'] / EMU)];
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('proportional handles', () => {
  it('every handle keeps the shape', () => {
    // 200×100 image.
    expect(proportionalResize('e', 200, 100, 50, 999)).toEqual({ width: 250, height: 125 });
    expect(proportionalResize('w', 200, 100, -50, 0)).toEqual({ width: 250, height: 125 });
    expect(proportionalResize('s', 200, 100, 999, 20)).toEqual({ width: 240, height: 120 });
    expect(proportionalResize('n', 200, 100, 0, 20)).toEqual({ width: 160, height: 80 });
    expect(proportionalResize('se', 200, 100, -100, 0)).toEqual({ width: 100, height: 50 });
    expect(proportionalResize('nw', 200, 100, -100, 0)).toEqual({ width: 300, height: 150 });
  });

  it('never shrinks the short side below 16px', () => {
    expect(proportionalResize('e', 200, 100, -500, 0)).toEqual({ width: 32, height: 16 });
    expect(proportionalResize('s', 100, 200, 0, -500)).toEqual({ width: 16, height: 32 });
  });
});

describe('image toolbar', () => {
  it('appears on select, goes on deselect, and never in a read-only view', () => {
    const view = setup(image(200, 100));
    expect(view.dom.querySelector('.pmd-image-toolbar')).toBeNull();
    select(view);
    expect(buttons(view).map((b) => b.textContent)).toEqual([
      '25%', '50%', '75%', 'Original size', 'Fit width', 'Alt text', 'Replace', 'Delete',
    ]);
    view.dispatch(view.state.tr.setSelection(NodeSelection.near(view.state.doc.resolve(1))));
    expect(view.dom.querySelector('.pmd-image-toolbar')).toBeNull();

    view.setProps({ editable: () => false });
    select(view);
    expect(view.dom.querySelector('.pmd-image-toolbar')).toBeNull();
  });

  it('scales from the original size and marks the current one', () => {
    const view = setup(image(200, 100));
    setNatural(view, 800, 400);
    select(view);
    expect(button(view, '25%').classList.contains('pmd-active')).toBe(true);
    button(view, '50%').click();
    expect(sizePx(view)).toEqual([400, 200]);
    // Still selected, toolbar refreshed.
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(button(view, '50%').classList.contains('pmd-active')).toBe(true);
    button(view, 'Original size').click();
    expect(sizePx(view)).toEqual([800, 400]);
  });

  it('fit width is the page text width (6.5in), whatever the pane', () => {
    const view = setup(image(200, 100));
    setNatural(view, 800, 400);
    select(view);
    button(view, 'Fit width').click();
    expect(sizePx(view)).toEqual([TEXT_COLUMN_PX, TEXT_COLUMN_PX / 2]);
  });

  it('size buttons are off when the original size is unknown', () => {
    const view = setup(image(200, 100));
    select(view);
    expect(button(view, '50%').disabled).toBe(true);
    // Fit width still works from the current shape.
    button(view, 'Fit width').click();
    expect(sizePx(view)).toEqual([624, 312]);
  });

  it('delete removes the image', () => {
    const view = setup(image(200, 100));
    select(view);
    button(view, 'Delete').click();
    expect(imagePos(view)).toBe(-1);
    expect(view.state.doc.textContent).toBe('abcd');
  });

  it('a toolbar mousedown is kept away from the editor', () => {
    const view = setup(image(200, 100));
    select(view);
    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button(view, '25%').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
  });
});

describe('fit to the page on insert', () => {
  it('shrinks only images wider than the column', () => {
    expect(fitToColumn(1248, 600)).toEqual({ width: 624, height: 300 });
    expect(fitToColumn(300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe('dropping image files', () => {
  it('inserts every image at the drop point and selects the last', () => {
    const view = setup();
    const ok = insertImageNodesAt(view, 2, [image(10, 10), image(20, 20)]);
    expect(ok).toBe(true);
    const kinds: string[] = [];
    view.state.doc.descendants((n) => {
      if (n.isInline) kinds.push(n.type.name === 'image' ? `img${n.attrs['widthEmu'] / EMU}` : n.text!);
    });
    expect(kinds).toEqual(['a', 'img10', 'img20', 'bcd']);
    const sel = view.state.selection as NodeSelection;
    expect(sel.node.attrs['widthEmu']).toBe(20 * EMU);
  });

  it('handleDrop takes image files, not other drops or in-editor drags', () => {
    const view = setup();
    const handleDrop = imageDropPlugin.props.handleDrop!;
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' });
    const drop = (files: File[]) =>
      ({ dataTransfer: { files }, clientX: 0, clientY: 0 }) as unknown as DragEvent;
    const call = (e: DragEvent) =>
      handleDrop.call(imageDropPlugin, view, e, (null as unknown) as never, false);
    expect(call(drop([txt]))).toBe(false);
    (view as unknown as { dragging: unknown }).dragging = { slice: null };
    expect(call(drop([png]))).toBe(false);
    (view as unknown as { dragging: unknown }).dragging = null;
    // posAtCoords is null in jsdom, but the drop is still claimed.
    view.posAtCoords = () => null;
    expect(call(drop([png]))).toBe(true);
  });
});

describe('dragstart carve-out', () => {
  const dragFrom = (el: Element) => ({ target: el }) as unknown as DragEvent;

  it('lets a drag on the picture through and selects just the image', () => {
    const view = setup(image(200, 100));
    const img = view.dom.querySelector('img[data-pmd-image]')!;
    expect(allowImageDragStart(view, dragFrom(img))).toBe(true);
    expect((view.state.selection as NodeSelection).node.type.name).toBe('image');
  });

  it('blocks drags from handles, the toolbar, text, and read-only views', () => {
    const view = setup(image(200, 100));
    select(view);
    const handle = view.dom.querySelector('.pmd-image-handle')!;
    const bar = view.dom.querySelector('.pmd-image-toolbar-btn')!;
    expect(allowImageDragStart(view, dragFrom(handle))).toBe(false);
    expect(allowImageDragStart(view, dragFrom(bar))).toBe(false);
    expect(allowImageDragStart(view, dragFrom(view.dom.querySelector('p')!))).toBe(false);
    view.setProps({ editable: () => false });
    expect(allowImageDragStart(view, dragFrom(view.dom.querySelector('img')!))).toBe(false);
  });
});
