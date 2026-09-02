#!/usr/bin/env node
/**
 * Verify (and, if needed, repair) the `electron` npm package's binary
 * install — run as apps/desktop's own `postinstall`.
 *
 * Two distinct problems this guards against:
 *
 * 1. electron@42's package.json declares no `postinstall`/`install` script
 *    at all — the download is lazy, triggered the first time something
 *    does `require('electron')` (node_modules/electron/index.js calls its
 *    own install.js on a cache miss). Nothing else in this project's
 *    install chain happens to require('electron') before this script
 *    runs, so on a fresh clone/CI runner the binary is simply never
 *    fetched. This script triggers that download itself, rather than
 *    only reactively checking for a binary nothing ever asked for.
 *
 * 2. Separately, on some Node versions (observed on Node v26.7.0, vs.
 *    this repo's pinned `.node-version` of 22 — see also the
 *    root/apps/desktop `engines.node` fields and `.nvmrc`), the
 *    `extract-zip`/`yauzl` chain bundled *inside* that install.js races
 *    and silently truncates the extraction — it stops after writing only
 *    a couple of files (never `node_modules/electron/path.txt`), and
 *    still exits 0 as if it had succeeded. The zip itself is valid (it
 *    extracts fine with the system `unzip`, or any other zip reader);
 *    the bug is specifically in that old bundled extractor. Undetected,
 *    this surfaces much later and far more confusingly, as an
 *    `ENOENT ... electron/path.txt` error out of `npm run desktop:dev`.
 *
 * So: trigger the download (problem 1), then check whether the install
 * actually landed. If not, look for the zip that attempt already put into
 * `@electron/get`'s cache (no need to re-download — the zip was never the
 * problem) and re-extract it ourselves with a native platform tool
 * instead of the buggy bundled one (problem 2). If no cached zip can be
 * found either, fail loudly with an actionable message — never a silent
 * success.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ELECTRON_DIR = path.join(__dirname, '..', 'node_modules', 'electron');
const DIST_DIR = path.join(ELECTRON_DIR, 'dist');
const PATH_TXT = path.join(ELECTRON_DIR, 'path.txt');

/** The relative-to-`dist/` executable path electron's own install.js
 *  writes into `path.txt`. Copied from `electron/install.js`'s
 *  `getPlatformPath` (a small, stable mapping) rather than imported —
 *  install.js is a script, not a module, so there's nothing to import. */
function platformExecutablePath(platform) {
  switch (platform) {
    case 'mas':
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'freebsd':
    case 'openbsd':
    case 'linux':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

/** Mirrors `electron/install.js`'s own platform/arch resolution
 *  (including its Apple-Silicon-under-Rosetta detection) so we search
 *  the cache for exactly the artifact install.js itself would have
 *  downloaded. */
function resolvePlatformArch() {
  const platform =
    process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform;
  let arch = process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch;

  if (
    platform === 'darwin' &&
    process.platform === 'darwin' &&
    arch === 'x64' &&
    process.env.npm_config_arch === undefined
  ) {
    try {
      const { execSync } = require('node:child_process');
      const output = execSync('sysctl -in sysctl.proc_translated');
      if (output.toString().trim() === '1') arch = 'arm64';
    } catch {
      // Not on Apple Silicon (or sysctl unavailable) — keep x64.
    }
  }
  return { platform, arch };
}

/** True iff `path.txt` exists and the executable it names is actually
 *  on disk. Deliberately just those two checks (matching what a normal
 *  `npm install` needs to have succeeded) — not a full file-count audit. */
function isProperlyInstalled() {
  if (!fs.existsSync(PATH_TXT)) return false;
  const relPath = fs.readFileSync(PATH_TXT, 'utf-8').trim();
  if (!relPath) return false;
  return fs.existsSync(path.join(DIST_DIR, relPath));
}

/** The ACTUAL resolved electron version for this install (e.g.
 *  "42.2.0", no "v" prefix) — read from the installed package's own
 *  package.json, the same source electron's install.js itself trusts,
 *  rather than re-parsing the semver range in apps/desktop/package.json. */
function installedElectronVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ELECTRON_DIR, 'package.json'), 'utf-8'));
  return pkg.version;
}

/** `@electron/get`'s default cache root (its `Cache` class defaults to
 *  `envPaths('electron', {suffix: ''}).cache`) — reimplemented directly
 *  rather than requiring the `env-paths` package, since it's a nested
 *  dependency we shouldn't rely on being resolvable mid-repair. Honors
 *  `electron_config_cache`, the same override install.js itself passes
 *  through to `downloadArtifact`. */
function electronCacheRoot() {
  if (process.env.electron_config_cache) return process.env.electron_config_cache;
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'electron');
  }
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'electron', 'Cache');
  }
  const xdgCache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(xdgCache, 'electron');
}

/** Find the cached zip for this exact version/platform/arch. `@electron/get`
 *  shards its cache into a subdirectory per download URL, hashed — an
 *  opaque, unpredictable name — but the FILENAME inside it is the
 *  deterministic `electron-v<version>-<platform>-<arch>.zip` GitHub
 *  Releases convention, so we scan one directory level deep for it
 *  rather than reimplementing the hash. Returns null if not found. */
function findCachedZip(version, platform, arch) {
  const cacheRoot = electronCacheRoot();
  if (!fs.existsSync(cacheRoot)) return null;
  const fileName = `electron-v${version}-${platform}-${arch}.zip`;
  let entries;
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(cacheRoot, entry.name, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Extract `zipPath` into `destDir` with a platform-native tool —
 *  deliberately NOT the `extract-zip`/`yauzl` chain this whole script
 *  exists to route around. `destDir` is wiped first so a prior partial
 *  extraction (e.g. the 2-file truncation this bug produces) can't leave
 *  stale files mixed in with the fresh ones. */
function extractWithNativeTool(zipPath, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  if (process.platform === 'win32') {
    // Expand-Archive ships with PowerShell 5+ (built into every supported
    // Windows version) — no reliance on `tar.exe` being present/on PATH.
    const escape = (s) => s.replace(/'/g, "''");
    const command =
      `Expand-Archive -LiteralPath '${escape(zipPath)}' -DestinationPath '${escape(destDir)}' -Force`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`PowerShell Expand-Archive exited with code ${result.status}.`);
    }
    return;
  }

  // macOS ships `unzip` out of the box; most Linux distros do too, with
  // `bsdtar` (libarchive) as a common fallback on minimal/container images.
  const attempts = [
    ['unzip', ['-q', '-o', zipPath, '-d', destDir]],
    ['bsdtar', ['-xf', zipPath, '-C', destDir]],
  ];
  let lastError = null;
  for (const [cmd, args] of attempts) {
    const result = spawnSync(cmd, args, { stdio: 'inherit' });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        lastError = result.error; // tool not installed — try the next one
        continue;
      }
      throw result.error;
    }
    if (result.status === 0) return;
    lastError = new Error(`${cmd} exited with code ${result.status}`);
  }
  throw lastError || new Error('No usable unzip tool found (tried: unzip, bsdtar).');
}

function fail(message) {
  console.error(`\n[verify-electron-binary] ${message}\n`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(ELECTRON_DIR)) {
    // Nothing to verify — the `electron` package itself never installed
    // (e.g. `npm install` failed earlier, or ran with --ignore-scripts).
    // Not this script's problem to diagnose; let npm's own error stand.
    return;
  }

  if (isProperlyInstalled()) return; // happy path — stay silent

  // electron@42's package.json has no `postinstall` at all — the binary
  // downloads lazily, the first time something does `require('electron')`
  // (see node_modules/electron/index.js: `module.exports = getElectronPath()`,
  // which calls install.js on a cache miss). Nothing in this project's own
  // install/build chain happens to trigger that require before this script
  // runs, so on a machine with no prior Electron cache (a fresh clone, a
  // clean CI runner) nothing has attempted a download yet — there is no
  // "cache to repair from" because nothing populated it. Kick off that
  // download ourselves here, so this script is the one thing guaranteed to
  // trigger it. Best-effort and swallowed: install.js's own extraction step
  // has the separate silent-truncation bug this script otherwise guards
  // against (see the repair path below), so a non-zero exit or a truncated
  // extract here is expected and fine — what we actually need out of this
  // call is the zip landing in @electron/get's cache, which happens before
  // extraction is attempted.
  console.warn(
    '[verify-electron-binary] electron is not installed — running its ' +
      'installer to trigger a download…',
  );
  spawnSync(process.execPath, [path.join(ELECTRON_DIR, 'install.js')], {
    stdio: 'inherit',
  });

  if (isProperlyInstalled()) return; // install.js's own extraction worked after all

  console.warn(
    '[verify-electron-binary] electron/path.txt (or the executable it names) is ' +
      'still missing — the bundled extractor likely failed silently (a known ' +
      'issue on some Node versions; this repo pins Node 22 — see .node-version ' +
      '/ .nvmrc). Attempting to repair from the download cache…',
  );

  let version, platform, arch;
  try {
    version = installedElectronVersion();
    ({ platform, arch } = resolvePlatformArch());
  } catch (err) {
    fail(
      `Could not determine the installed electron version/platform to repair: ${err.message}\n` +
        'Fix: re-run `npm run desktop:install`.',
    );
    return;
  }

  const zipPath = findCachedZip(version, platform, arch);
  if (!zipPath) {
    fail(
      'electron is not installed correctly, and no cached download for ' +
        `electron-v${version}-${platform}-${arch}.zip was found to repair from ` +
        `(looked under ${electronCacheRoot()}).\n\n` +
        'Fix: re-run `npm run desktop:install` with a working network connection ' +
        '(this re-downloads the zip), or check your connection if it fails again.',
    );
    return;
  }

  try {
    extractWithNativeTool(zipPath, DIST_DIR);
    const relPath = platformExecutablePath(platform);
    const target = path.join(DIST_DIR, relPath);
    if (!fs.existsSync(target)) {
      throw new Error(`extraction completed but the expected executable is still missing: ${target}`);
    }
    // Zip extraction doesn't always preserve the executable bit faithfully
    // across tools/platforms — make sure it's actually runnable.
    if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
    fs.writeFileSync(PATH_TXT, relPath);
    console.log(
      `[verify-electron-binary] Repaired: re-extracted electron ${version} from the cached ` +
        'download and wrote path.txt.',
    );
  } catch (err) {
    fail(
      `Failed to repair the electron install from the cached download: ${err.message}\n\n` +
        'Fix: delete the cached download and re-run `npm run desktop:install`:\n' +
        `  rm -rf "${path.dirname(path.dirname(zipPath))}"`,
    );
  }
}

main();
