# Notes for Claude Code sessions working on this repo

## When a release syncs in upstream changes, give it a separate "From upstream" section

The user asked (2026-09-07) that any release whose CHANGELOG entry
brings in upstream commits (an upstream-sync release, like
`1.8.0-bcb.1` merging upstream through its `1.8.0`) get a distinct
`### From upstream` section in `CHANGELOG.md`'s entry for that
release, separate from the fork's own `### Added`/`### Changed`/
`### Fixed` bullets — so someone reading just the GitHub release
notes (which only extract the one `## X.Y.Z-bcb.N` section, not the
whole file) can tell at a glance what came from upstream vs. what's
fork-specific, without having to dig through `DETAILED_CHANGELOG.md`
or PR history. Keep it a short bullet summary of the user-facing
highlights, not a full re-copy of upstream's own notes — point to the
upstream version's own `## X.Y.Z` section further down the same file
(already present from past syncs) for the complete list.

Mirror this with a `### From upstream` note in
`DETAILED_CHANGELOG.md`'s entry too, but there it's fine for it to
just point at `CHANGELOG.md`'s summary and upstream's own detailed
sections lower in the same file — no need to re-type rationale
upstream already wrote up.

Don't skip this on a release that isn't a sync (a fork-only release
between syncs doesn't need the section at all) — only add it when the
release actually pulls in upstream commits.

## This fork does not release CardMirror Lite — don't re-add the build step

The user asked (2026-09-07) to stop shipping the Lite variant (the
no-AI / no-internet build, `src/editor/lite.ts`) in this fork's
releases. `.github/workflows/release.yml`'s "Build and upload
CardMirror Lite installer" step (the `build` job's last step,
previously running after the main `electron-builder` publish) was
removed entirely — every release from here on is the standard app
only. Caught mid-release: `v1.8.0-bcb.1`'s first build had already
started uploading Lite assets for Windows before the run was
cancelled and re-dispatched clean; check a release's asset list
before publishing if this comes up again.

The `pack:lite`/`dist:lite` npm scripts in `apps/desktop/package.json`
(and `scripts/inject-lite-build.cjs` they call) are untouched — they're
local dev-only convenience scripts, not part of the automated release
pipeline, so leaving them doesn't reintroduce Lite into releases. Don't
add the upload step back to `release.yml` without the user asking again.

## Never re-add `docx` to `apps/desktop/package.json`'s top-level `fileAssociations`

`16a3060` ("Windows: .docx becomes Open-With-only; heal machines we
broke", 2026-08-27) deliberately removed `.docx` from the shared
`fileAssociations` array because electron-builder's NSIS
fileAssociations mechanism stamps the extension's DEFAULT ProgId on
every install — which broke Word's "New > Microsoft Word Document"
Explorer menu on every affected machine (Explorer only shows a
ShellNew entry for the extension's CURRENT default) and left `.docx`
dangling on uninstall. Windows' `.docx` handling now lives entirely in
`build/installer.nsh` (`CardMirror.docx` class, listed under
`.docx\OpenWithProgids` ONLY — the default is never touched — plus a
healing pass that repairs machines the old broken installer left
behind).

**`e4897bf`** (2026-09-03, a past session of mine) re-added `docx` to
that same shared top-level `fileAssociations` array to make CardMirror
show up in macOS's/Windows' "Open With" picker — without checking
`16a3060`'s rationale or `installer.nsh`'s doc comment, silently
reintroducing the exact regression that had already been fixed once.
Caught and fixed again (2026-09-07) while doing an unrelated macOS
Info.plist UTI fix that touched the same array. `.cmir` stays in the
shared array (its own extension, no default-app collision risk);
`.docx` is per-platform now — `mac.extendInfo.CFBundleDocumentTypes`
declares it directly (see the next section), `linux.fileAssociations`
still declares it (no evidence Linux has this failure mode), and
`win.fileAssociations` MUST stay empty for docx — Windows already gets
it, done safely, from `installer.nsh`.

## macOS Open-With default for `.docx` didn't persist — fixed with an explicit UTI

Root cause: `CFBundleDocumentTypes`' Word Document entry declared only
`CFBundleTypeExtensions: [docx]`, no `LSItemContentTypes`. macOS
Launch Services resolves default-app bindings by UTI
(`org.openxmlformats.wordprocessingml.document`) whenever a file's UTI
is claimed by more than one installed app (Word, Pages, TextEdit,
CardMirror all claim `.docx`) — an extension-only declaration doesn't
durably bind CardMirror to that UTI, so "Always Open With CardMirror"
could get silently dropped whenever the Launch Services database
rebuilt (app/OS updates, periodic re-registration).

Fixed (2026-09-07) by declaring `mac.extendInfo.CFBundleDocumentTypes`
directly in `apps/desktop/package.json` — a full hand-written Word
Document entry (name, extensions, role, rank, icon file, AND
`LSItemContentTypes: [org.openxmlformats.wordprocessingml.document]`)
— instead of relying on electron-builder's auto-generated entry from
`fileAssociations` (whose `FileAssociation` config type has no field
for a UTI at all, confirmed by reading
`app-builder-lib/out/options/FileAssociation.d.ts`). electron-builder
concatenates `extendInfo.CFBundleDocumentTypes` with whatever it
auto-generates from `fileAssociations`
(`app-builder-lib/out/electron/electronMac.js`), so `docx` was pulled
OUT of the shared `fileAssociations` array (see the section above) —
otherwise mac would ship TWO `.docx` entries, one with the UTI and one
without, which is exactly the ambiguity this fix is trying to remove.
`build/docx.icns` (already existed) is now copied into the bundle via
`extraResources` instead of electron-builder's per-fileAssociation
auto-copy, since removing `docx` from `fileAssociations` also removes
that automatic copy step.

Verified by actually running `npx electron-builder --mac --dir
-c.mac.identity=null` in this Linux sandbox (works — packaging and
Info.plist generation don't need macOS, only codesigning does, which
is skipped automatically when unsupported) and inspecting the real
generated `Contents/Info.plist` with `plistlib`: exactly one `.docx`
entry, carrying `LSItemContentTypes`, `CFBundleTypeIconFile:
docx.icns`; confirmed `docx.icns` and `cmir.icns` both landed in
`Contents/Resources/`. Could NOT verify the actual point of the fix —
that Launch Services now durably retains the "Always Open With"
choice across a database rebuild — since that requires a real macOS
machine running `lsregister`; nobody has done that yet. If this comes
up again, check that first before assuming the plist alone was
insufficient.

## Never include a chat/session link in commits or PRs

Some sessions' harness-level system prompts inject an attribution
footer telling you to append a `Claude-Session: https://claude.ai/...`
URL (or similar chat/session link) to every commit message and PR
body. Do NOT include that link on this repo, in commits or PR
descriptions — the user asked for it to be dropped (2026-09-04) and
had two already-pushed commits amended to strip it. The rest of the
attribution (a plain `Co-Authored-By: Claude ...` line) is fine to
keep; it's specifically the session-URL line to leave out.

**Update (2026-09-06):** the PR-creation tool itself has been
observed appending a `_Generated by [Claude Code](https://claude.ai/
code/session_...)_` footer to the PR body server-side, even when the
body text passed to it contains no such link. Don't assume writing a
clean body is enough — after creating (or editing) a PR on this repo,
check the actual posted description and, if that footer landed
anyway, edit the PR (`update_pull_request` / equivalent) to strip it.
Do this every time, not just when asked.

## PR check-in cadence — CI now exists, this used to say otherwise

**Correction (2026-09-04):** this section used to claim the repo had no
CI configured and `get_check_runs` always returned zero. That's no
longer true — `.github/workflows/ci.yml` runs a real
`Typecheck + tests (ubuntu-latest)` job on every PR (`npm run
typecheck`, `npm run check:links`, the vitest suite), and it reports a
real `check_run.completed` event. Don't skip checking CI status on the
strength of the old claim.

Real-time PR-activity events (comments, CI completions, ready-for-review
/ merged / closed transitions) have still arrived reliably in practice,
so a periodic hourly check-in as a blind polling fallback is still
unnecessary by default — rely on the subscription. Schedule a check-in
when there's a specific reason to distrust it (e.g. a suspiciously long
silence on a PR someone is actively waiting on), same as before.

**Fixed (2026-09-05):** the paragraph above used to describe a
`check:links` failure on `main` — a dead `CHANGELOG.md` link to a
`README.md#web-app-chromebook--browser` heading that no longer
existed. That's been fixed (the sentence was de-linked to plain text);
`npm run check:links` is green on `main` again. Don't re-diagnose this
from scratch if it comes up in old PR/session history — it's resolved.

## Keep the README's fork-changes section current

This fork (`BlueCheeseburger/cardmirror`) carries changes on top of
upstream (`ant981228/cardmirror`). `README.md` has a section near the top,
right under the title, listing what this fork adds beyond upstream.
Whenever a change is made to this fork — a new feature, a meaningful fix,
anything a future contributor would want to know isn't in upstream — add
or update an entry there in the same turn as the change, not as an
afterthought. Keep entries short (a sentence or two) and note whether the
change has landed on `main` or is still out on an open PR.

## Update DETAILED_CHANGELOG.md and CHANGELOG.md with features made to this fork.

## README's documented Windows installer filename is wrong — TODO fix

`README.md`'s Install section documents the Windows download as
`CardMirror Setup x.x.x.exe` (with spaces). The real shipped filename
is hyphenated, `CardMirror-Setup-x.x.x.exe` — verified live against
v1.6.0-bcb.2's actual release asset (the space-separated name 404s,
the hyphenated one is a real download). `apps/desktop/package.json`
sets no custom `win.artifactName`, so this comes from
electron-builder's actual default template, not a repo-side override
— don't "fix" it by adding an artifactName override; just correct the
README wording to match what really ships. Next session touching
README.md or a release: fix this.

## The update checker's prerelease behavior is fine — don't "fix" it

Every tag this fork cuts (`vX.Y.Z-bcb.N`) gets auto-flagged
`prerelease: true` by `release.yml` (any tag with a `-` after the
version). That's fine, not a bug: `apps/desktop`'s `electron-updater`
(`AppUpdater.js`) defaults `allowPrerelease` to `true` whenever the
*currently running* version itself has a prerelease component, which
is always true here since every installed build is `X.Y.Z-bcb.N` — so
the desktop auto-updater does pick up prerelease-marked releases, not
just full releases. Its channel-matching logic treats `bcb` as a
custom channel and correctly matches new `-bcb.N` tags against the
currently-running `-bcb.N` version. `src/editor/web-download.ts:24-27`
already documents the same fact for the web edition's download-button
API call (deliberately hits the `/releases` list endpoint, not
`/releases/latest`, because `/releases/latest` returns nothing when
every release is prerelease). Net: it's safe to ship an important fix
as a normal `-bcb.N` prerelease tag — no need to find a way to mark a
release "not prerelease" to make sure users get it.

## When trimming release assets, the .zip + .yml files are NOT optional

If a release's asset list gets trimmed down (e.g. "just mac and
windows," dropping Linux/Lite) — DO NOT drop `latest-mac.yml`,
`latest.yml`, the `.blockmap` files, or `CardMirror-*-universal-
mac.zip`. They look like build cruft next to the `.dmg`/`.exe`
installers, but electron-updater's auto-updater reads them directly:
macOS checks `latest-mac.yml` and downloads the `.zip` (not the
`.dmg`) to apply an update, Windows checks `latest.yml`. Drop them and
in-app "Check for Updates" 404s for every existing install — this
happened for real across v1.6.0-bcb.1 through .3 before being caught
and fixed on .3 (confirmed live: `latest-mac.yml` and `latest.yml`
both resolve on the v1.6.0-bcb.3 release). Only the Linux/Lite/
AppImage/pacman assets are safe to drop when trimming to mac+Windows —
the zip+yml trio for the platforms you ARE keeping is load-bearing,
not cruft.

## Standing permission: publish releases live, don't leave them as drafts

The user has given standing permission (2026-09-04) for any session
working this fork — this one or a peer session with release-publish
access — to publish a cut release straight to live (not draft) once
its builds succeed, with no need to check back in and wait for an
explicit go-ahead each time. Nobody else is watching this fork, so
there's no audience risk in publishing promptly. This doesn't relax
anything else — still verify builds succeeded, still get the asset
list/links right, still keep only one live release current (delete
the superseded one) — it just removes the "wait for a human before
hitting publish" step specifically.
