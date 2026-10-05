/**
 * Bundling several send pieces into one wire item. Shared by the Send
 * pill's drag path and the keyboard send commands, so a multi-piece
 * send reads the same in the receiver's inbox however it was started.
 */
import { Fragment, Slice } from 'prosemirror-model';
import type { SendItem } from './relay-client.js';

export interface CapturedItem {
  slice: Slice;
  type: string;
  label: string;
}

/** A multi-selection ships as ONE item the receiver grabs atomically —
 *  the slices concatenate into a single slice (they arrive in document
 *  order), so the wire format is unchanged and any receiver build, old
 *  or new, inserts the whole set in one go. Only closed node-level
 *  slices bundle; a send carrying an open text fragment falls back to
 *  per-item sends (concatenating open slices would splice unrelated
 *  textblocks together). */
export function bundleSendItems(items: CapturedItem[]): SendItem[] {
  if (items.length <= 1 || items.some((i) => i.slice.openStart !== 0 || i.slice.openEnd !== 0)) {
    return items.map((i) => ({ label: i.label, type: i.type, sliceJson: i.slice.toJSON() }));
  }
  let content = Fragment.empty;
  for (const i of items) content = content.append(i.slice.content);
  const first = items[0]!;
  return [
    {
      label: `${first.label} + ${items.length - 1} more`,
      type: first.type,
      sliceJson: new Slice(content, 0, 0).toJSON(),
    },
  ];
}
