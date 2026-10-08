/**
 * Tagline extraction for the tagline index: read a `.docx` / `.cmir` file and
 * list the card taglines inside it. Runs in the file-index utility process.
 */

import * as fsp from 'node:fs/promises';
import { fromDocx } from '../../../src/import/index.js';
import { parseNative } from '../../../src/native/index.js';
import { extractTaglines, type TaglineRecord } from '../../../src/editor/tagline-search.js';

/** Files larger than this are skipped (a stray scan or archive, not a doc). */
const MAX_FILE_BYTES = 150 * 1024 * 1024;

export async function parseTaglines(filePath: string): Promise<TaglineRecord> {
  const st = await fsp.stat(filePath);
  if (st.size > MAX_FILE_BYTES) return { tags: [], cites: [] };
  const bytes = new Uint8Array(await fsp.readFile(filePath));
  const doc = /\.docx$/i.test(filePath) ? await fromDocx(bytes) : parseNative(bytes).doc;
  return extractTaglines(doc);
}
