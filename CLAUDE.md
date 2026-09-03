# Notes for Claude Code sessions working on this repo

## PR check-in cadence

This repo has no CI configured — `pull_request_read` / `get_check_runs`
returns zero check runs on every PR, every time. When a session opens a
PR here and subscribes to its activity, don't schedule periodic (e.g.
hourly) check-in reminders as a CI-polling fallback: there's no CI to go
red, and ready-for-review / merged / closed transitions have arrived
reliably as real-time PR-activity events in practice. Rely on the
subscription; only schedule a check-in when there's a specific reason to
distrust it (e.g. a suspiciously long silence on a PR someone is actively
waiting on).

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
