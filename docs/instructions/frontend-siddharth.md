# Instructions for Siddharth (Frontend Developer) — SIH 2026 LEX Workbench

## 1. Workspace Configuration
Configure the frontend workspace to use mock JSON responses. This allows bypassing
heavy local AI inference during UI development and iterating faster.

## 2. Dynamic Multi-Objective Routing UI
Build UI sliders in the React Single-Page Application (SPA). These sliders must allow
users to dynamically adjust the routing weights for speed, reliability, and intelligence
on a 0-100 scale.

## 3. Git Governance & Environment Isolation
Follow Git branch protection rules on the frontend repository structure. Ensure all UI
iterations are pushed to isolated sub-branches (e.g., `feat/frontend-ui`) before merging
via a Pull Request to the main branch.

## 4. Detailed UI Vision (Offline-First Design)
This section outlines the visual direction for the LEX Workbench UI. While the reference
designs are inspired by cloud API dashboards, remember that LEX operates in a strictly
air-gapped, offline environment. All concepts must be adapted for local execution.

### 4.1 Models Page & Routing Strategy
Build a "Models" page where users can view available local models and select a routing
strategy (e.g., Manual, Balanced, Custom).

Reference layout (freellmapi):
- Header: "Models" with subtitle "Pick a routing strategy. In Manual mode you drag to
  set the order; the other strategies route by live score across reliability, speed and
  intelligence."
- Top-right tab bar: Chat models / Embeddings / Image / Video / Audio / Fusion
- "Monthly token budget" panel: a horizontal usage bar, with "X remaining · Y% of Z used"
  displayed top-right. Below the bar, a multi-column list of models each showing a colored
  dot, name, and a "used/quota" fraction (e.g., "507.3K / 3.0M").
- A "Show all N models" expand link below the list.
- "Routing strategy" panel: tab row of presets — Manual, Balanced, Smartest, Fastest,
  Most reliable, Custom — plus an "Adjust" control. Shows current live split as text
  (e.g., "reliability 33% · speed 0% · intelligence 67%"). A note: "Scores update from
  live traffic. The order below is how requests are routed right now."

**LEX adaptation:** since LEX is offline, replace "monthly token budget" framing (which
implies a metered cloud quota) with local compute/VRAM budget context if relevant — do
not imply network-metered usage. Confirm with the team before deciding the exact label;
do not silently keep cloud-specific language.

### 4.2 Model Scoring & Ranking
Create a detailed list view of all loaded models (e.g., Qwen, Moondream) displaying
their baseline scores for Reliability, Speed, and Intelligence.

Reference layout (freellmapi):
- Search bar ("Search models or providers…") plus filter chips: Vision, Tools,
  Any context, 32K+, 128K+, 1M+, and Enable all / Disable all buttons.
- A count line: "N of M shown models are in the chain."
- A table with columns: # (rank), Model (name + provider count + context size + tags
  like Vision/Tools), Reliability (bar + numeric range), Speed (bar + numeric range),
  Intelligence (bar + numeric range), Guardrails, Score (decimal, with "best of N"
  sub-label), On (toggle switch).
- Rows are sorted by Score descending.

**LEX adaptation:** "provider count" and per-provider pricing/RPD limits don't apply to
local models — replace with something locally meaningful (e.g., VRAM footprint,
resident/on-demand status) rather than leaving stale cloud-provider fields in place.

### 4.3 Custom Weights Configuration
Implement sliders for the "Custom" routing strategy, allowing users to balance
Reliability, Speed, and Intelligence on a 0-100 scale to dynamically calculate the
routing scores.

Reference layout (freellmapi):
- Panel titled "Custom weights" with subtitle "Sliders are independent; shares
  auto-balance to 100%."
- Three labeled sliders, each with a colored dot, name, live percentage value, and a
  horizontal drag track: Reliability (green), Speed (blue), Intelligence (purple).
- An "Applied" confirmation button/state at the bottom.
- Sliders auto-rebalance so all three always sum to 100% when one is adjusted.

This maps directly to the `RoutingWeights` schema (speed/reliability/intelligence,
0-100 integers) — coordinate the exact field names with whoever implements the backend
schema so the payload keys match exactly.

### 4.4 Playground & Interaction Interface
Design a chat/playground interface for direct agent interaction, file uploads, and
system prompt configuration.

Reference layout (freellmapi):
- Left sidebar: "New chat" button, chat history list.
- Top nav: FreeLLMAPI brand, Models / Playground / Agents / Analytics / Premium tabs.
- Main pane: message thread (user/assistant turns), input box at the bottom.
- Right sidebar (Settings panel): Model selector dropdown, "Dictation model" selector
  (with "Auto (fallback chain)"), "System prompt" free-text field, "Sampling" controls
  (Temperature, Top P, Max tokens — each with a "Default" toggle to use the provider's
  own defaults).

### 4.5 Local Analytics Dashboard
Adapt the analytics dashboard layout for **local** metrics. Instead of online API costs
or network bandwidth, track:
- Local inference latency and Time To First Token (TTFT).
- Total local tokens processed (input/output).
- Subtask and tool execution success rates (e.g., Sandbox execution, OCR, RAG retrieval).

Reference layout (freellmapi):
- Header: "Analytics" with subtitle "Request volume, latency, token usage, and
  failures," plus a time-range selector (24h / 7d / 30d / 90d).
- Top stat cards, 4x2 grid: Requests, Success rate, Input tokens, Output tokens,
  Avg latency, P95 latency, Avg TTFT, Est. savings.
- "Requests over time" line chart (Failures vs Success, two lines).
- "Tokens over time" line chart (Input tokens vs Output tokens).
- Below: "Requests by provider" bar chart, "Requests by agent" bar chart,
  "Avg latency by provider" bar chart (with Avg + P95 series), "Time to first token by
  provider" bar chart, "Error distribution" horizontal bar chart (Other / Rate Limited
  429 / Unavailable 503 / Not Found 404 / etc.), "Errors by provider" bar chart.

**LEX adaptation — this is important, do not copy verbatim:**
- Drop "Est. savings" entirely — there is no cloud cost being saved locally.
- Drop or repurpose "by provider" charts — LEX has local models, not multiple API
  providers with rate limits; if kept, rename to reflect local model identity instead.
- Do NOT implement anything resembling network bandwidth or external API cost tracking
  — LEX is air-gapped and must not display metrics implying external network calls.
- Do keep: latency, TTFT, token counts, success/failure rates, and add
  subtask/tool-specific success rates (sandbox exec, OCR, RAG retrieval) which the
  freellmapi reference does not have an equivalent for — this is LEX-specific and must
  be designed fresh, not copied from a screenshot.

### 4.6 Audit Logs & Recent Calls
Create a detailed log of recent agent invocations, showing the selected local model,
execution status, and token usage per turn.

Reference layout (freellmapi):
- "Recent calls" header with filter chips: All / Success / Errors / Canceled, and an
  "All providers" dropdown.
- Table columns: Time, Client IP, Client app, Model, Provider, Status, Attempts,
  In tokens, Out tokens.

**LEX adaptation:** "Client IP" and "Provider" are less meaningful for a single-operator
local system — consider replacing "Provider" with the specific local model tag, and
confirm whether "Client IP" (loopback only, presumably) is worth keeping or should be
replaced with "Client app" alone (e.g., which harness/session made the call).

### 4.7 Per-Model Breakdown
Display a usage breakdown per local model to help the operator understand hardware
utilization and memory swapping.

Reference layout (freellmapi):
- Table columns: Model, Provider, Requests, Pinned, Success, Latency, In tokens,
  Out tokens.

**LEX adaptation:** replace "Pinned" (a cloud-routing concept) with residency status
(resident: true/false, matching the `models.yaml` registry), and consider adding a
VRAM-usage column since hardware utilization is explicitly the stated goal here.

### 4.8 Prompt Compression Settings
Design a Settings modal for "Prompt compression" to allow users to reduce request size
before routing.

Reference layout (freellmapi):
- Modal header: "Settings" with left nav tabs (General, Compression, Advanced, Preview).
- "Prompt compression" section with description: "Reduce request size before routing
  while preserving code, errors, paths, numbers, and tool definitions."
- "Mode" selector: Off / Lossless / Standard / Aggressive (segmented control).
- "Engines" section, two-column grid of toggle cards:
  - **Lossless** column: "Repeated blocks" (dedup), "Whitespace cleanup",
    "JSON tables" (jsoncompact)
  - **Lossy** column: "Superseded file reads" (read-lifecycle), "Tool output filter"
    (toolfilter), "Relevance filter" (relevance), "Older turns" (aging),
    "Token ceiling" (hard-budget)
- Each toggle card shows a short label plus a small secondary tag underneath
  (e.g., "dedup · Lossless").
- "Save changes" button, bottom right.

This maps directly to the `PromptCompressionConfig` schema (mode + 8 boolean engine
toggles) — field names must match exactly what the backend schema uses:
`repeated_blocks`, `whitespace_cleanup`, `json_tables`, `superseded_file_reads`,
`tool_output_filter`, `relevance_filter`, `older_turns`, `token_ceiling`.

## 5. Coordination Notes
- Confirm exact `RoutingWeights` and `PromptCompressionConfig` field names with the
  backend/schema developer before wiring the UI to real endpoints — do not guess names.
- For any section marked "LEX adaptation" above, do not silently copy the cloud-oriented
  original — flag ambiguous adaptation decisions back to the team rather than picking
  one option and presenting it as settled.
