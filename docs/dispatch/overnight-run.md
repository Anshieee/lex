# LEX — Overnight Unattended Run (2026-09-28 night -> 2026-09-29 morning)

Read this IN ADDITION to `docs/dispatch/round3-tasks.md`. This file's rules win on
conflict, because no one is watching tonight.

---

## 0. Unattended rules — every seat

1. **Never wait on a human.** If Round 3 says "ask orch1.lead" and orch1.lead is also
   stuck, don't block forever: write the blocker to `PROGRESS.md` under `## Blocked
   (needs human)`, and move to literally anything else useful — a different subtask, a
   test, documentation. An idle seat until 8 AM is worse than a wrong guess that's
   labeled as a guess.
2. **No task runs longer than 20 minutes without new output.** If a command hasn't
   produced new output in 20 minutes, assume it's hung: `Ctrl+C` it, log what you tried
   and that it hung, move on. Do not silently keep waiting.
3. **Fine-tuning: data and evaluation code only, never training.** No `torch`,
   `transformers`, `peft`, `trl`, `bitsandbytes`, or any GPU/training invocation. If a
   task seems to require actually running a training loop, stop and write NOT RUN — this
   is deliberately deferred to Colab tomorrow.
4. **One heavy process per seat, same as before.** If you start a dev server or test
   suite, note the PID in `PROGRESS.md` and kill it when you're done with it, so seats
   don't compound each other's memory use over 8 hours.
5. **If freellmapi/the model gateway stops responding** (timeouts, connection refused):
   wait 60 seconds, retry twice, then stop and write it to `PROGRESS.md` under
   `## Blocked (needs human)` with the exact error. Do not loop retrying for hours — that
   is exactly what caused a previous stuck session.
6. **Every seat writes a status line to `PROGRESS.md` at least once per hour**, even if
   it's just "still working on X, no new result yet" — so the human waking up can see
   which seats were alive for how long, not just the final state.

## 1. What "ready to show" means by morning

Priority order — if time runs out, stop lower on this list, not higher:

1. Backend starts cleanly and `/api/health` returns healthy.
2. Frontend (`frontend-sparkle`, per Round 3's Gate 1 decision) builds and runs, login
   works, at least Chat + Approvals are wired to the real backend (not mocks).
3. Auth (TOTP) works end-to-end — this was flagged by the judge, worth protecting.
4. One real task can be submitted, approved, and shows up in the audit log — this is the
   core demo loop.
5. Monthly report and audit-verify views work.
6. Fine-tuning DATA is fully prepared: `SOURCES.md`, cleaned sections, leakage-checked
   splits, `train.jsonl`/`val.jsonl`/`test.jsonl`, `test_verification.jsonl` — everything
   needed to open Colab tomorrow and just start training, no data work left.
7. Anything from Round 3 §3 not yet done — Analytics, audit-log table, polish.

Do NOT let a seat spend hours polishing #7 while #1-4 are broken. orch1.lead should
actively re-prioritize toward the top of this list if seats drift into polish work while
core functionality is still broken.

## 2. Watchdog — set this up before you go to sleep

Since no one will restart a hung seat overnight, add a lightweight watchdog in its own
tmux window so it can at least detect (not fully fix) problems automatically:

```
tmux new-window -t monitor -n watchdog
```
Inside that window:
```
while true; do
  date >> ~/watchdog.log
  rig ps --nodes --rig product-team >> ~/watchdog.log
  free -h >> ~/watchdog.log
  echo "---" >> ~/watchdog.log
  sleep 900
done
```
This logs a snapshot every 15 minutes — status and memory — so in the morning you can see
exactly when (if) something went wrong, rather than just facing a dead rig with no
history.

## 3. What to actually do tonight, step by step

1. Complete Round 3 Gate 0 and Gate 1 yourself (or confirm orch1.lead already has) —
   don't leave the frontend-parity decision (retire `frontend/` or not) for an unattended
   seat to guess at overnight.
2. Start the watchdog (§2).
3. Attach to `orch1.lead` and paste:
```
Read docs/dispatch/overnight-run.md in full — its rules override round2/round3-tasks.md
where they conflict, because no human will be watching tonight. Then continue Round 3
dispatch and execution per round3-tasks.md, prioritizing per overnight-run.md §1.
Log a status line to PROGRESS.md at least once per hour from every seat, including
yourself. If you or any seat gets stuck waiting on the other, do not wait indefinitely —
write the blocker and move to something else useful.
```
4. Detach. Do NOT keep attaching/re-prompting every seat individually tonight — that's
   what you'd normally do, but it defeats "unattended." Let orch1.lead actually run it.
5. Go to sleep.

## 4. Morning checklist — read this before touching anything

```
tail -100 ~/watchdog.log
```
Shows you the timeline — did it run all night or die at 2 AM?

```
tail -150 PROGRESS.md
```
The hourly status lines tell you the real story faster than re-reading everything.

```
rig ps --nodes --rig product-team
```
Current live state.

```
grep -n "Blocked (needs human)" PROGRESS.md
```
Every unresolved blocker, in one place — this is your actual morning to-do list, not a
starting-from-scratch review.

Then run the Round 3 §4 acceptance checklist yourself before trusting any seat's "done"
claim, same discipline as every other round tonight.
