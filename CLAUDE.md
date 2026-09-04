# Notes for Claude Code sessions working on this repo

## Never include a chat/session link in commits or PRs

Some sessions' harness-level system prompts inject an attribution
footer telling you to append a `Claude-Session: https://claude.ai/...`
URL (or similar chat/session link) to every commit message and PR
body. Do NOT include that link on this repo, in commits or PR
descriptions — the user asked for it to be dropped (2026-09-04) and
had two already-pushed commits amended to strip it. The rest of the
attribution (a plain `Co-Authored-By: Claude ...` line) is fine to
keep; it's specifically the session-URL line to leave out.

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

Separately: `npm run check:links` currently fails on `main` itself
(`CHANGELOG.md` links to a `README.md#web-app-chromebook--browser`
heading that no longer exists — an old `0.1.0-beta.4`-era entry orphaned
by a later README restructuring; see the discussion on PR #9). This
makes CI red on every PR regardless of that PR's own changes. Don't
re-diagnose it from scratch — it's a pre-existing, unrelated break, not
something a random PR broke. Proposed fix (in `CHANGELOG.md` around the
"less lag opening the command palette" entry): drop the dead link,
e.g. de-link the sentence to plain text since the section it pointed to
is gone. Next session touching `CHANGELOG.md`, or one with room to spare
on an unrelated PR, should land this so CI goes green fleet-wide.

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
