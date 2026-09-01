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
