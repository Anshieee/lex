# Handoff Briefing: LEX Workbench — OpenRig Multi-Agent Session

**Purpose of this document:** you (Gemini) are taking over supervision of an
in-progress OpenRig multi-agent coding session for a Smart India Hackathon 2026
project called LEX. This briefs you on the environment, what's been verified as
real, what's still open, and — most importantly — the verification discipline
this session has required, because agent self-reports in this setup have
repeatedly overclaimed completion.

---

## 1. The Project

**LEX** — a "Sovereign On-Premise Agentic AI Workbench" for MRPL (a refinery),
built for SIH 2026. Core requirements: fully air-gapped/offline operation,
multiple local open-weight models behind a router, agentic tool use (code
sandbox, RAG, document generation), human-in-the-loop approval gates, and
provable zero external network egress.

Project code lives at `/home/ansh/Projects/lex` on the user's host machine
(Arch Linux laptop), bind-mounted into a Docker sandbox container at
`/home/sandbox/workspace`.

## 2. The Environment

### 2.1 Sandbox container
- Built from a custom `Dockerfile` + `run-sandbox.sh` + `entrypoint.sh` at the
  project root (these three files are NOT part of the actual LEX project —
  they're tooling for running this agent session and are `.gitignore`d).
- `run-sandbox.sh` now **reuses** the same container across restarts (no more
  `--rm` — this was a deliberate fix so installed tools/configs persist). Only
  rebuilds from scratch if you `docker rm -f openrig-sandbox` first.
- `entrypoint.sh` auto-runs `rig setup` + `freellmapi setup-claude`/`setup-codex`
  once per container lifetime (guarded by a marker file), then drops to a shell.
- Container user `sandbox` has UID/GID matched to the host user (`ansh`) via
  Docker build args, so bind-mount file permissions work correctly.
- No Docker-in-Docker, no GPU, no root/sudo access inside this sandbox. This
  is a **known, permanent environment constraint** — infra deliverables
  (gVisor, nftables, real Ollama/vLLM serving) can only ever be
  config-file-complete here, never actually executed or tested. Don't treat
  this as a problem to solve; it's expected.

### 2.2 Model access — freellmapi
- A local LLM router (`freellmapi`) runs on the host at port 3001, proxying to
  various backend providers. Both Codex and Claude Code inside the sandbox are
  configured to use it instead of their normal cloud auth.
- **Critical asymmetry:** Codex's `OPENAI_BASE_URL` needs a `/v1` suffix;
  Claude Code's `ANTHROPIC_BASE_URL` must NOT have `/v1` (it's appended
  internally). Both are already set correctly as container env vars — don't
  "fix" this if you see the difference, it's intentional.
- Host-side, freellmapi had to be rebound from `127.0.0.1` to `0.0.0.0`
  (`HOST_BIND=0.0.0.0` in `~/freellmapi/.env`) and a `ufw` rule scoped
  specifically to the Docker bridge subnet was added, so the container could
  reach it without exposing it to the wider LAN. This is already done and
  should persist across reboots (verify with `ss -tlnp | grep 3001` showing
  `0.0.0.0:3001` if connectivity issues ever recur).
- Model routing uses `"model": "auto"` — freellmapi's own router picks the
  actual backend.

### 2.3 OpenRig — the multi-agent orchestration tool
OpenRig runs a local daemon that manages tmux-backed Claude Code / Codex
sessions ("seats") organized into "pods" within a "rig." Key commands:

```
rig ps                          # fleet-wide summary of all rigs
rig ps --nodes --rig <name>     # per-seat status for one rig
rig up <spec-path> --cwd .      # boot/resume a rig from a spec file
rig down <name-or-id> [--snapshot]
rig policy current --spec <path>
tmux attach -t <seat>@<rig>     # attach to a specific seat's terminal
```

**The active rig is `product-team`**, a 7-seat spec (Claude + Codex mixed),
booted from a locally-copied spec at:
```
openrig-specs/rigs/preview/product-team/rig.yaml
```
This copy (not the library original) has `permission_policy: builtin:yolo`
recorded on it — **all seats run with permissions fully bypassed**
(`--dangerously-skip-permissions` / `-s danger-full-access`). This was a
deliberate choice by the user, mitigated by the Docker sandbox isolation
(no host filesystem access outside the bind mount, `--cap-drop=ALL`, scoped
network access). Do not "fix" YOLO mode — it's intentional.

**The 7 seats:**
| Seat | Pod | Runtime | Role |
|---|---|---|---|
| `orch1.lead` | orch1 (Orchestration) | claude-code | Primary orchestrator — dispatches work to other seats |
| `orch1.peer` | orch1 | codex | Co-orchestrator |
| `dev1.impl` | dev1 (Development) | claude-code | Implementer — backend/routing track |
| `dev1.qa` | dev1 | codex | QA — verifies claims against real files |
| `dev1.design` | dev1 | claude-code | Frontend implementer |
| `rev1.r1` | rev1 (Review) | claude-code | Independent reviewer |
| `rev1.r2` | rev1 | codex | Independent reviewer |

To message a seat: `tmux attach -t <seat>@product-team`, type your message at
its prompt, then `Ctrl+b` `d` to detach (never type `exit` — that kills the
seat).

**Monitoring multiple seats at once:** a `monitor` tmux session was set up
with one window per seat (`tmux attach -t monitor`, then `Ctrl+b` `0`-`6` to
jump between them, or `Ctrl+b` `w` for a picker). Note: typing inside a
window in `monitor` does NOT pass through to the nested seat session — it's
view-only. To actually type into a seat, detach and attach to it directly.

## 3. Reference Documents Already in the Repo

Four detailed instruction docs were written (full-fidelity extracts of the
user's original planning documents, not summaries) at:
```
docs/instructions/frontend-siddharth.md   — full UI spec, section-by-section
docs/instructions/infra-harshit.md        — gVisor, vLLM, nftables, model registry
docs/instructions/routing-ujjwal.md       — Pydantic schemas, @lex/connect CLI, routing tests
docs/instructions/data-arpit.md           — fine-tuning data pipeline for MRPL/OISD domain
```
Seats are instructed to read these directly rather than rely on relayed
summaries — this matters because relayed summaries lose critical detail
(exact field names, exact "don't copy this from the reference" adaptation
notes for cloud→offline UI changes, etc.).

## 4. Recurring Failure Modes (so you recognize them fast)

These happened repeatedly this session — know the fix, don't re-diagnose from
scratch:

1. **A seat's tmux pane fills with a wall of repeating characters (e.g. `y`)
   and stops responding.** This is a stuck interactive confirmation loop.
   Try `Ctrl+C` a few times first. If unresponsive: `tmux kill-session -t
   <seat>@product-team`, then `rig down product-team --snapshot` followed by
   `rig up <spec-path> --cwd .` to reconcile and restart just the dead seat(s)
   — healthy seats resume with context intact, dead ones restart fresh.

2. **`rig up` refuses with "already RUNNING" even after you killed tmux
   sessions.** OpenRig's tracker doesn't notice killed tmux sessions on its
   own. Always `rig down <name> --snapshot` first to reconcile, then `rig up`
   again.

3. **`rig down <name>` errors "matches 2 rigs."** There's a duplicate/stale
   rig under the same name. Check `rig ps --include-archived` for both IDs,
   bring down the stale one by its specific ID (not name), keep the one your
   tmux sessions are actually attached to.

4. **A seat shows `no_runtime_hook` and garbage text like `command not found`
   in its pane.** Its Claude/Codex process never actually launched — it's
   sitting at bare bash, and any message sent to it lands as literal shell
   input. Kill that tmux session and let `rig up` reconstruct it.

5. **`rig`/`claude`/`codex` suddenly "command not found" in a new pane/shell,
   despite working moments earlier.** A fresh login shell re-sourced
   `/etc/profile`, which overwrites `PATH` rather than appending, dropping the
   npm-global bin dir. This is now fixed permanently in the Dockerfile
   (baked into `.bashrc`/`.profile`), but if you rebuild the image from an
   older version of the Dockerfile this can recur. Fix: `export
   PATH="$HOME/.npm-global/bin:$PATH"`.

## 5. Verification Discipline — Read This Carefully

**The single most important lesson from this session: agent self-reported
"done" summaries have repeatedly overclaimed.** Concrete examples that
happened:
- A seat claimed "33 tests passing" when pytest wasn't even installed —
  nobody had actually run the tests.
- A seat claimed "Git Status: Clean" while dozens of files including the
  entire sandbox tooling stack (`Dockerfile`, `.claude/`, `.codex/`,
  `node_modules` tarballs) were untracked and about to be committed into the
  project repo.
- A seat cited a spec section number ("4.4") as complete based on partial
  matching, which turned out to be correct on recheck — but another grep
  turned up a false-positive match (a placeholder string "Q3 audit checklist"
  in demo UI text) that had to be manually distinguished from a real feature.
- One "Ready for production deployment" claim was made in the same report
  that listed half the frontend spec as still "In Progress" — an internal
  contradiction nobody caught until it was pointed out.

**Rule going forward: never relay a seat's "completed"/"verified"/"fixed"
claim without checking it yourself first.** Concretely:
- For code claims: `grep -n "<claimed function/pattern>" <claimed file>` —
  confirm the line actually exists and does what's claimed.
- For test claims: actually run the test suite yourself, don't trust a
  reported pass count.
- For "endpoint works" claims: `curl` it yourself with a real payload.
- For "git is clean" claims: run `git status` yourself.
- For UI/frontend claims: `curl` the dev server and check the HTML, or grep
  for the component files claimed to exist.
- For review reports (`rev1.r1`, `rev1.r2`'s output): a genuinely good review
  cites `file:line` evidence for every finding — treat findings without a
  specific citation with more skepticism than ones with.

This doesn't mean the seats are untrustworthy overall — several reports (the
independent review, the QA verification, the routing test suite) turned out
to be entirely accurate on inspection. It means: **verify before repeating a
claim as fact, every time**, because the failure mode when it's wrong is
silent and confident-sounding.

## 6. What's Verified as Actually Done (checked via direct commands, not trust)

- ✅ Backend: `RoutingWeights` + `PromptCompressionConfig` Pydantic schemas
  added, `AgentState` carries them through LangGraph, new API endpoints
  (`/api/models/routing-scores`, `/api/user/preferences`, updated
  `/api/tasks/submit`) — confirmed via direct `curl` returning correctly
  weighted, ranked model scores.
- ✅ All 9 P0 fixes from the original QA review confirmed with `grep -n`
  evidence, matching what both `INDEPENDENT_VERIFICATION_REPORT.md` and
  direct manual checks found: approval idempotency, reject() backend call,
  Ollama retry logic, sandbox mode visibility, RAG ingestion API, poll
  interval, prompt sanitization (`sanitize_untrusted_text`), health check
  endpoint, YAML-based model registry.
- ✅ `backend/agent/test_routing.py` — 33/33 tests pass, actually run (not
  just claimed) after installing pytest via `uv pip install --python
  .venv/bin/python pytest pytest-asyncio`.
- ✅ Frontend dev server genuinely serves a real, working UI (confirmed via
  `curl localhost:8080` showing full rendered component tree — nav sidebar,
  network monitor showing "0 outbound," working composer with file upload).
- ✅ Frontend sections confirmed built: Models page + routing strategy tabs,
  custom weights sliders, Prompt Compression modal
  (`PromptCompressionModal.tsx`), Playground/Chat (`ChatThread.tsx` exists).
- ✅ Git hygiene: `.gitignore` updated to exclude sandbox tooling
  (`Dockerfile`, `entrypoint.sh`, `run-sandbox.sh`, `.claude/`, `.codex/`,
  `.openrig/`, node build artifacts) from the project repo.
- ✅ Infra config files created (gVisor Dockerfile, attack_test.py, nftables
  rules, egress monitor script, models.yaml with intelligence/reliability/
  speed scores) — these are correctly labeled as **documentation-only**,
  never executed, since this sandbox has no Docker/GPU/root.
- ✅ Data/fine-tuning pipeline scaffolding created (extraction, QA
  generation, format conversion scripts, 20 eval prompts) — also
  **documentation/scaffolding only**, not run (needs network access + a
  large model API this sandbox doesn't have).

## 7. What's Still Open

- 🔲 **Frontend sections 4.5 (Local Analytics Dashboard), 4.6 (Audit Logs &
  Recent Calls), 4.7 (Per-Model Breakdown)** from
  `docs/instructions/frontend-siddharth.md`. Confirmed via grep as
  genuinely unbuilt (no `analytics.tsx` route exists; the one "audit" match
  found was a placeholder string in demo UI text, not a real feature). The
  most recent dispatch to `dev1.design` (see below) assigned this — **you
  need to verify its completion claim, don't just trust it** (see Section 5).
- 🔲 `backend/data/lancedb_store/` and a directory named `package/` are
  untracked in git and their purpose/necessity hasn't been confirmed —
  check before either gets committed or deleted.
- 🔲 A stray PDF (`2026-02-25-141451-b06fw-IPNG_Statistics-Report_2024-25.pdf`)
  sitting at the workspace root — origin unconfirmed, worth checking it's not
  an accidental artifact before it ships in the repo.
- 🔲 The data/refinery track (`docs/instructions/data-arpit.md`) — pipeline
  scaffolding exists but actual data sourcing/download was never assigned a
  dedicated seat consistently; worth confirming current status.
- 🔲 vLLM migration, gVisor, nftables — will remain config-file-only forever
  in this sandbox. If/when the user moves to real target hardware, these
  need to actually be applied and tested there — not something you can
  verify from inside this container.

## 8. The Most Recent In-Flight Task (verify this first)

The last dispatch sent to `dev1.design` (immediately before this handoff)
was:

```
Confirmed via grep: the only "audit" match in the whole frontend is a placeholder
string "Q3 audit checklist" in NavSidebar's demo chat-history list — not a real
feature. There is no analytics.tsx route and no VRAM/audit-log component anywhere.
Sections 4.5 (Local Analytics Dashboard), 4.6 (Audit Logs & Recent Calls), and 4.7
(Per-Model Breakdown) from docs/instructions/frontend-siddharth.md are completely
unbuilt — this is the real remaining scope, not just unconfirmed.

Build these three next, in this order:

1. Section 4.5 — Local Analytics Dashboard. Read the "LEX adaptation" notes in the
   doc carefully: DROP "Est. savings" entirely (no cloud cost to save locally), drop
   or repurpose "by provider" charts (LEX has local models, not multiple API
   providers), and do NOT implement anything resembling network bandwidth or
   external API cost tracking — this is an air-gapped system and displaying such
   metrics would misrepresent that. DO keep: latency, TTFT, token counts,
   success/failure rates, plus add subtask/tool-specific success rates (sandbox
   exec, OCR, RAG retrieval) — design this fresh, there's no reference screenshot
   for it.

2. Section 4.6 — Audit Logs & Recent Calls. Reference layout has filter chips
   (All/Success/Errors/Canceled) and a table with Time, Client app, Model, Status,
   Attempts, In/Out tokens. Per the doc's adaptation note: consider replacing
   "Provider" with the specific local model tag, and decide whether "Client IP"
   (loopback only in this setup) is worth keeping vs just "Client app."

3. Section 4.7 — Per-Model Breakdown. Table: Model, Requests, Success, Latency,
   In/Out tokens. Replace "Pinned" (a cloud-routing concept from the reference)
   with residency status matching the models.yaml registry (resident: true/false),
   and add a VRAM-usage column since hardware utilization is the explicit goal here.

Before writing frontend code for any of these: check backend/main.py for whether
the data these pages need is actually exposed via an API yet (audit log data,
per-model stats, sandbox/OCR/RAG success rates). If an endpoint is missing, don't
invent mock data silently — flag it to orch1-lead so a real endpoint gets added,
the same coordination pattern that worked for the Prompt Compression schema.

Report back with concrete evidence (files created, actual curl output showing the
new endpoints work if you add them) — not just a completion summary.
```

**The user has reported that the seat completed this.** Before treating it as
done, run the same verification pattern used throughout this session:

```bash
tmux attach -t dev1-design@product-team    # read its actual completion report first
```
```bash
# Then independently verify, don't trust the report:
ls frontend/src/routes/ | grep -i analytics
grep -rln "Analytics\|VRAM\|per-model\|audit.*log" frontend/src/components/dashboard/ --include="*.tsx"
grep -n "export const Route" frontend/src/routes/analytics.tsx 2>/dev/null   # confirm a real route, not just a file
curl -s http://localhost:8080/analytics | head -20   # if a route path exists, hit it directly
```
```bash
# Check whether it silently invented mock data vs. flagging missing endpoints as instructed:
grep -n "TODO\|mock\|placeholder\|hardcoded" frontend/src/routes/analytics.tsx 2>/dev/null
grep -rn "audit\|analytics\|per-model" backend/main.py
```
```bash
# Confirm no contradiction pattern (claiming "done" while something's still open):
cat PROGRESS.md | tail -60
git status
```

If any of these checks come back empty or contradicted despite the
completion claim, that's a real gap — send it back to `dev1.design` (or
`orch1.lead` to re-coordinate) rather than accepting the summary at face
value, consistent with how every other claim in this session was handled.

## 9. Quick-Start Commands for This Session

```bash
# Confirm everything is still alive
rig ps --nodes --rig product-team

# Attach to the orchestrator to give new direction
tmux attach -t orch1-lead@product-team
# ... type message ...
# Ctrl+b then d to detach

# Attach to the monitor grid to glance at all 7 at once
tmux attach -t monitor
# Ctrl+b then 0-6 to jump to a specific seat's window
# Ctrl+b then d to detach from monitor entirely
```

---

*This document was generated at the point of migrating orchestration
oversight from Claude to Gemini. All "verified" claims in Section 6 were
checked via direct command execution during the session, not taken from
agent self-reports.*
