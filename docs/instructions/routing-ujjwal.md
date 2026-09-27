# Instructions for Ujjwal (Routing Data & API Integration) — SIH 2026 LEX Workbench

## Step 1 — Pydantic Schema Expansion (`schemas.py`)
**Objective:** update backend data contracts to accept the new dynamic routing weights
and prompt-compression settings from the frontend.

- **Routing Weights Schema:** new `RoutingWeights` Pydantic model with `speed`,
  `reliability`, `intelligence` fields. Enforce validation: integers, 0-100 only.
- **Compression Config Schema:** new `PromptCompressionConfig` model mapping the
  frontend UI state to the backend:
  - `mode` field, `Literal["Off", "Lossless", "Standard", "Aggressive"]`
  - Boolean toggles: `repeated_blocks`, `whitespace_cleanup`, `json_tables`,
    `superseded_file_reads`, `tool_output_filter`, `relevance_filter`, `older_turns`,
    `token_ceiling`
- **Agent State Injection:** update the primary `AgentState` TypedDict to incorporate
  both `RoutingWeights` and `PromptCompressionConfig` so these user preferences are
  carried through every node of the LangGraph execution loop.

Add comprehensive field descriptions using `Field(description="...")` on every new
field, so the frontend team knows exactly what payload structure the FastAPI endpoint
expects — this is not optional polish, it's the interface contract between tracks.

## Step 2 — Air-Gapped API Client & Local NPM Registry
**Objective:** expose the host machine's local vLLM OpenAI-compatible endpoint to
external coding harnesses (DeepSeek harness, Hermes agent, etc.) running on air-gapped
developer laptops via a zero-config `npx` command.

- **Verdaccio Initialization:** stand up a local `verdaccio` private NPM registry on
  the host workstation. Configure it to operate entirely offline — disable proxy
  lookups to npmjs.org.
- **CLI Tool Development (`@lex/connect`):** a lightweight Node.js CLI package that:
  - Automatically detects the host machine's local IP address on the internal subnet.
  - Acts as a seamless terminal configurator, printing the exact shell export commands
    needed to tunnel requests, e.g.:
    ```
    export OPENAI_BASE_URL="http://<host-ip>:8000/v1"
    export OPENAI_API_KEY="lex-local"
    ```
- **Package Publishing:** publish the CLI to the local Verdaccio registry so any
  air-gapped laptop on the internal network can initialize the connection with:
  ```
  npx --registry http://<host-ip>:4873 @lex/connect
  ```

## Step 3 — Multi-Objective Routing Testing & Context Validation
**Objective:** validate that the LangGraph router correctly calculates priority scores
and seamlessly preserves the vLLM KV-cache prefix during model handoffs.

- **Score Calculation Verification:** isolated unit tests for the router node. Pass
  mock `RoutingWeights` (e.g., heavily weighting Intelligence) and verify the scoring
  equation selects the correct model from the `models.yaml` registry:
  ```
  Final Score = (w_speed * S) + (w_reliability * R) + (w_intelligence * I)
  ```
- **Cache Handoff Tracing:** trigger a multi-step task that forces a model switch
  (e.g., Vision model back to the core Reasoning model).
- **Message State Inspection:** validate the LangGraph state machine injects the
  entire `messages` array into the prompt payload during the switch — the new model
  must inherit the full conversation history for vLLM's `--enable-prefix-caching` to
  actually produce cache hits.

## Important architectural note (context preservation across model switches)
Native KV-cache transfer *between different model architectures* (e.g., Qwen to Phi)
is physically impossible — tensor dimensions differ. Zero context loss across a switch
is achieved by LangGraph acting as the source of truth: when routing to a new model,
inject the exact accumulated `messages` list into the new prompt. vLLM's automatic
prefix caching then means that if you swap *back* to a previously used model, it
instantly reloads the shared prompt prefix without recomputing — this is a cache-hit
optimization, not a cross-architecture cache transfer.

## Git Version Control & Documentation Workflow
1. **Branch Naming:** dedicated branch per task, e.g. `feat/dynamic-routing-schemas`,
   `feat/lex-connect-cli`. Never commit directly to `main`.
2. **Commit Messages:** Conventional Commits. `feat` for new capabilities, `fix` for
   bugs, `test` for routing validations.
3. **Documentation:** comprehensive Pydantic field descriptions in `schemas.py` via
   `Field(description="...")`. A brief `README.md` for the `@lex/connect` CLI
   explaining how developers configure DeepSeek/Hermes harnesses to consume the local
   vLLM endpoint.
4. **Pull Requests:** push the isolated branch, open a PR against `main`. Require
   both backend and infrastructure peer review before merging — schema changes
   directly impact FastAPI payload parsing and model routing execution on both sides.
