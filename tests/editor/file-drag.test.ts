// @vitest-environment jsdom
/**
 * Handing a document's file to another app by dragging (file-drag.ts): the
 * footer badge and the blue title bar are drag sources. dragstart cancels the
 * DOM drag and asks the host to start the native one with the folder mark as
 * the icon; with no file on disk, no desktop host, or a shell that can't start
 * a native drag, nothing starts.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  FILE_MARK_DATA_URL,
  filePathOf,
  installFileDragSource,
  startNativeFileDrag,
  type FileDragHost,
} from '../../src/editor/file-drag.js';

function fakeHost(can = true): FileDragHost & { drags: [string, string][] } {
  const h = {
    drags: [] as [string, string][],
    canDragFileOut: () => can,
    dragFileOut(path: string, icon: string) {
      h.drags.push([path, icon]);
    },
    showItemInFolder: vi.fn(async () => {}),
  };
  return h;
}

describe('filePathOf', () => {
  it('is the handle when it is a path, and null for anything else', () => {
    expect(filePathOf('/docs/Aff.cmir')).toBe('/docs/Aff.cmir');
    expect(filePathOf('')).toBeNull();
    expect(filePathOf(null)).toBeNull();
    expect(filePathOf({ kind: 'file' })).toBeNull();
  });
});

describe('startNativeFileDrag', () => {
  it('starts the drag with the folder mark as the icon', () => {
    const host = fakeHost();
    expect(startNativeFileDrag(host, '/docs/Aff.cmir')).toBe(true);
    expect(host.drags).toEqual([['/docs/Aff.cmir', FILE_MARK_DATA_URL]]);
  });

  it('does nothing without a file, a host, or a shell that can start a native drag', () => {
    const host = fakeHost();
    expect(startNativeFileDrag(host, null)).toBe(false);
    expect(startNativeFileDrag(null, '/a.cmir')).toBe(false);
    const old = fakeHost(false);
    expect(startNativeFileDrag(old, '/a.cmir')).toBe(false);
    expect(host.drags).toHaveLength(0);
    expect(old.drags).toHaveLength(0);
  });
});

describe('installFileDragSource', () => {
  it('cancels the DOM drag and starts the native one for the current file', () => {
    const host = fakeHost();
    const el = document.createElement('div');
    let path: string | null = '/docs/Aff.cmir';
    installFileDragSource(el, () => path, () => host);
    expect(el.draggable).toBe(true);
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(host.drags).toEqual([['/docs/Aff.cmir', FILE_MARK_DATA_URL]]);
    // asked at drag time: a renamed / switched document drags the new file
    path = '/docs/Neg.docx';
    el.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    expect(host.drags[1]![0]).toBe('/docs/Neg.docx');
  });

  it('refuses the drag with no file on disk, and on the web', () => {
    const host = fakeHost();
    const el = document.createElement('div');
    installFileDragSource(el, () => null, () => host);
    el.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    expect(host.drags).toHaveLength(0);
    const web = document.createElement('div');
    installFileDragSource(web, () => '/a.cmir', () => null);
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    expect(() => web.dispatchEvent(ev)).not.toThrow();
  });

  it('the disposer removes the handler and the draggable flag', () => {
    const host = fakeHost();
    const el = document.createElement('div');
    const dispose = installFileDragSource(el, () => '/a.cmir', () => host);
    dispose();
    expect(el.draggable).toBe(false);
    el.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    expect(host.drags).toHaveLength(0);
  });
});
