/**
 * Speech-engine runtime: where the downloaded sherpa-onnx packages live
 * and how they are fetched and checked. Pure helpers (no Electron) so
 * the layout, naming, and integrity rules are unit-testable; ipc.ts
 * wires them to userData and the download UI.
 *
 * Why a download at all: most people never turn voice on, and the
 * native runtime is ~32 MB per platform (both mac slices ride in the
 * universal build), so it stays out of the installer like the 640 MB
 * model does. The two npm packages — `sherpa-onnx-node` (JS glue) and
 * the per-platform `sherpa-onnx-<os>-<arch>` (the N-API addon plus
 * onnxruntime) — are laid out under a node_modules directory so the
 * worker's `require('sherpa-onnx-node')` resolves through NODE_PATH and
 * the addon's own sibling-package lookup works unchanged.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Pinned engine version. The devDependency copy must match, so dev and
 *  packaged builds run the same binaries. */
export const SHERPA_VERSION = '1.13.7';
/** Approximate compressed size of both packages, for the prompt. */
export const ENGINE_DOWNLOAD_MB = 10;
export const NPM_REGISTRY = 'https://registry.npmjs.org';

/** Upstream publishes the Windows package as `sherpa-onnx-win-x64`
 *  (the `win32` name tripped npm's spam filter). */
export function platformPackageName(platform: string = process.platform, arch: string = process.arch): string {
  return `sherpa-onnx-${platform === 'win32' ? 'win' : platform}-${arch}`;
}

/** Both packages a host needs, glue first. */
export function enginePackages(platform?: string, arch?: string): string[] {
  return ['sherpa-onnx-node', platformPackageName(platform, arch)];
}

export function packumentUrl(name: string, version: string = SHERPA_VERSION): string {
  return `${NPM_REGISTRY}/${name}/${version}`;
}

export interface PackumentDist {
  tarball: string;
  integrity: string;
}

/** The registry's per-version document carries the tarball URL and an
 *  SRI string; refuse anything that is not an https tarball with a
 *  sha512 entry so a tampered or truncated document cannot downgrade
 *  the check. */
export function parsePackument(json: unknown): PackumentDist {
  const dist = (json as { dist?: { tarball?: unknown; integrity?: unknown } } | null)?.dist;
  const tarball = typeof dist?.tarball === 'string' ? dist.tarball : '';
  const integrity = typeof dist?.integrity === 'string' ? dist.integrity : '';
  if (!tarball.startsWith('https://')) throw new Error('engine packument: no https tarball');
  const sha512 = integrity.split(/\s+/).find((s) => s.startsWith('sha512-'));
  if (!sha512) throw new Error('engine packument: no sha512 integrity');
  return { tarball, integrity: sha512 };
}

/** Present = the glue package plus this host's native addon, both where
 *  NODE_PATH will look. */
export function enginePresentAt(nodeModules: string, platform?: string, arch?: string): boolean {
  return (
    fs.existsSync(path.join(nodeModules, 'sherpa-onnx-node', 'package.json')) &&
    fs.existsSync(path.join(nodeModules, platformPackageName(platform, arch), 'sherpa-onnx.node'))
  );
}

/** Streams `file` through sha512 and compares with the SRI value. */
export async function verifyIntegrity(file: string, integrity: string): Promise<void> {
  const expected = integrity.replace(/^sha512-/, '');
  const hash = crypto.createHash('sha512');
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file).on('data', (chunk) => hash.update(chunk)).on('end', resolve).on('error', reject);
  });
  const actual = hash.digest('base64');
  if (actual !== expected) throw new Error(`engine download failed its integrity check (${path.basename(file)})`);
}
