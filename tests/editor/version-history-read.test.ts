// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { schema, newHeadingId } from '../../src/schema/index.js';
import { serializeNative } from '../../src/native/index.js';
import { toDocx } from '../../src/export/index.js';
import { parseSnapshotBytes } from '../../src/editor/version-history.js';

const sampleDoc = () =>
  schema.nodes['doc']!.createChecked(null, [
    schema.nodes['card']!.createChecked(null, [
      schema.nodes['tag']!.create({ id: newHeadingId() }, schema.text('Tag one')),
      schema.nodes['card_body']!.create(null, schema.text('body text')),
    ]),
  ]);

describe('parseSnapshotBytes', () => {
  it('reads a native snapshot', async () => {
    const doc = await parseSnapshotBytes(serializeNative(sampleDoc(), {}));
    expect(doc.textContent).toContain('Tag one');
  });
  it('reads a snapshot stored as .docx bytes (older builds did this for Word docs)', async () => {
    const bytes = await toDocx(sampleDoc());
    expect(bytes[0]).toBe(0x50); // a zip
    const doc = await parseSnapshotBytes(bytes);
    expect(doc.textContent).toContain('Tag one');
    expect(doc.textContent).toContain('body text');
  });
});
