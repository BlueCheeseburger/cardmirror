/**
 * Export just a part of a document as a new file: the Card menu's
 * "Export as New File…" row, on the toolbar's Card dropdown and on the outline's
 * right-click Card submenu. The ranges are whatever those menus act on: the
 * card the cursor is in, or the right-clicked heading together with everything
 * under it (a whole block, hat or pocket).
 *
 * The new file holds only those pieces, in document order, as a standalone
 * document: card numbers start again from the first card in it, live views are
 * written out as real cards (a view of something outside the section could not
 * travel with it), and the file's format follows the "new documents" default.
 * Nothing about the open document changes, and the export is not added to its
 * name or recent files, like the Send / Read doc exports.
 */
import { Fragment, type Node as PMNode } from 'prosemirror-model';
import { schema, newHeadingId } from '../schema/index.js';
import { serializeNativeAsync, toDocx } from '../index.js';
import { transformForExport } from '../export/transform-for-export.js';
import { applyNumberingExport } from './numbering-bake.js';
import { flattenSelfRefsInFragment } from './self-transclusion.js';
import { settings } from './settings.js';
import { getHost, getElectronHost } from './host/index.js';
import { showPresetSavedNotice } from './preset-saved-notice.js';
import { showToast } from './toast.js';
import { alertDialog } from './text-prompt.js';
import { appVersion } from './install-info.js';

export interface ExportRange {
  from: number;
  to: number;
}

/** The pieces `ranges` cover as a standalone document, in document order with
 *  overlaps merged, or null when they cover nothing. */
export function sectionDocFromRanges(doc: PMNode, ranges: readonly ExportRange[]): PMNode | null {
  const sorted = ranges
    .filter((r) => r.to > r.from)
    .map((r) => ({ from: Math.max(0, r.from), to: Math.min(doc.content.size, r.to) }))
    .sort((a, b) => a.from - b.from);
  const merged: ExportRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else merged.push({ ...r });
  }
  const nodes: PMNode[] = [];
  for (const r of merged) {
    // A live view (self_ref) is resolved against the WHOLE document, which is
    // still in hand here, before it is cut down to the section.
    const frag = flattenSelfRefsInFragment(doc.slice(r.from, r.to).content, doc, newHeadingId);
    frag.forEach((n) => nodes.push(n));
  }
  if (nodes.length === 0) return null;
  try {
    const out = schema.nodes['doc']!.create(null, Fragment.fromArray(nodes));
    out.check();
    return out;
  } catch {
    return null;
  }
}

/** A file name for the section: the text of its first line, made safe for a
 *  file name, or "Export" when there is none. */
export function suggestedSectionName(section: PMNode): string {
  let text = '';
  section.descendants((n) => {
    if (text) return false;
    if (n.isTextblock && n.textContent.trim()) {
      text = n.textContent;
      return false;
    }
    return true;
  });
  const safe = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return safe || 'Export';
}

/** Ask where to save, and write the section there. Resolves true when a file
 *  was written, false when the section was empty or the dialog cancelled. */
export async function exportRangesAsDocument(doc: PMNode, ranges: readonly ExportRange[]): Promise<boolean> {
  const section = sectionDocFromRanges(doc, ranges);
  if (!section) {
    showToast('Nothing to export here.');
    return false;
  }
  const format: 'cmir' | 'docx' = settings.get('defaultSaveFormat');
  try {
    const exportNode = transformForExport(applyNumberingExport(section, 'keep'), {
      includeComments: false,
      includeAnalytics: true,
      includeUndertags: true,
      readMode: false,
      markedCardsOnly: false,
      starredOnly: false,
      markUnreadAfterMarker: false,
    });
    const bytes =
      format === 'cmir'
        ? await serializeNativeAsync(exportNode)
        : await toDocx(exportNode, {
            defaultFont: settings.get('bodyFont'),
            generator: { application: 'CardMirror', version: appVersion },
          });
    const filename = `${suggestedSectionName(section)}.${format}`;
    const result = await getHost().saveAs(filename, bytes, {
      filters:
        format === 'cmir'
          ? [{ name: 'CardMirror native (.cmir)', extensions: ['cmir'] }]
          : [{ name: 'Microsoft Word (.docx)', extensions: ['docx'] }],
    });
    if (!result) return false;
    showPresetSavedNotice('Export', result.name, result.handle, getElectronHost()?.showItemInFolder?.bind(getElectronHost()));
    return true;
  } catch (err) {
    console.error('Export failed:', err);
    void alertDialog(`Export failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
