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

## Update DETAILED_CHANGELOG.MD with features made to this fork.
