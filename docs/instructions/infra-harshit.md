# Instructions for Harshit (Infrastructure, Sandbox & Serving) — SIH 2026 LEX Workbench

## Step 0.1 — Measure Hardware & Calculate VRAM Budget
Before downloading large files, profile the exact GPU memory available on the target
workstation.

1. Check GPU specs: `nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv`
2. Apply the system formula:
   ```
   Available VRAM = Total VRAM - OS/Display Reserve (~1.5-2.0 GB) - KV Cache Reserve (~1.5 GB)
   Resident Budget = Available VRAM * 0.85
   ```
3. Determine residency strategy:
   - 12 GB+ VRAM: keep `Qwen2.5-7B-Instruct` resident; load coding/vision models on
     demand or resident as headroom allows.
   - 8 GB VRAM: keep only `Qwen2.5-7B-Instruct` resident; all other models load
     on-demand and evict immediately after execution.
   - Log the exact budget numbers for the team's tracking (originally destined for
     Arpit's Phase 0 checklist).

## Step 1 — gVisor Sandbox Integration and Attack Validation
**Objective:** Configure the host environment to use a user-space kernel for secure AI
code execution and create the validation mechanism to prove isolation.

- **Daemon Registration:** Locate the Docker daemon config file on the target Linux host
  and register the gVisor `runsc` runtime — specify the absolute path to the `runsc`
  binary within the config's `runtimes` dictionary:
  ```json
  {
    "runtimes": {
      "runsc": { "path": "/usr/local/bin/runsc" }
    }
  }
  ```
- **Service Restart:** `sudo systemctl restart docker` to load the new runtime.
- **Verify registration:** `docker info | grep -i runsc`
- **Validation Script Logic (`attack_test.py`):** a Python script with two distinct
  tests using standard library modules only:
  - *Network Egress Test:* attempt a `socket.create_connection(("8.8.8.8", 53),
    timeout=2)`. Log `[PASS]` if it raises an exception (connection refused/blocked),
    `[FAIL]` if it succeeds.
  - *Filesystem Traversal Test:* attempt `open("/etc/shadow", "r")`. Log `[PASS]` only
    if a permission or unreachability error is raised, `[FAIL]` if the read succeeds.
- **Execution & Proof:** run a temporary container with `--runtime=runsc
  --network=none --memory=512m --cpus=1.0`, mount `attack_test.py` read-only, execute
  it, and confirm both tests report `[PASS]`.
- **Sandbox base image (`Dockerfile.sandbox`):**
  ```dockerfile
  FROM python:3.11-slim
  RUN pip install --no-cache-dir numpy pandas openpyxl scipy matplotlib
  WORKDIR /sandbox
  USER nobody
  ```
  Build: `docker build -t local-sandbox:latest -f Dockerfile.sandbox .`

## Step 2 — Download Open-Weight Models & Set Up Serving Engine
Set up Ollama (or llama.cpp-server) for local OpenAI-compatible inference endpoints.

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Core Reasoning & Planning Model (~4.7 GB)
ollama pull qwen2.5:7b-instruct-q4_K_M
# Coding Specialist Model (~4.7 GB)
ollama pull qwen2.5-coder:7b-instruct-q4_K_M
# Lightweight Vision Fallback Model (~1.5 GB)
ollama pull moondream
```

Verify zero-external-network local inference:
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:7b-instruct-q4_K_M",
  "prompt": "Respond with: LOCAL_INFERENCE_ONLINE",
  "stream": false
}'
```

## Step 2 (superseding revision) — vLLM Migration and Context Cache Optimization
**Objective:** Transition from Ollama to vLLM for production-grade continuous batching,
prefix caching, and tuned memory allocation to avoid OOM crashes on large document
ingestion.

- **Engine Transition:** gracefully stop/disable Ollama; initialize vLLM pointing
  directly at the local model weight directories (quantized files or safetensors).
- **Prefix Caching:** explicitly enable automatic prefix caching at vLLM startup
  (`--enable-prefix-caching`). Since LangGraph repeatedly resends the same system
  prompts and accumulated message history during multi-step reasoning, this reuses the
  precomputed KV cache and reduces TTFT for subsequent agent routing steps.
- **Max Token & Memory Tuning:** anticipate the frontend's "Token ceiling" compression
  engine being fully disabled by the user, allowing a massive uncompressed scanned
  document to be ingested. Manually calculate the hardware memory budget (same formula
  as Step 0.1) and apply strict upper limits to the server's max model context length
  and max concurrent sequences in the batch (`--max-num-seqs`, `--max-model-len`).
- **Endpoint Verification:** send a standard OpenAI-compatible REST payload to the
  local vLLM port (typically 8000). Send the exact same payload a second time and
  monitor the vLLM console output to confirm the prefix-cache "hit rate" registers —
  proving context is preserved across interactions.

## Step 3 — Create the Central Model Registry (`models.yaml`)
Structured config so the backend can dynamically route tasks without hardcoding
endpoints.

```yaml
version: "1.0"
engine: "ollama"   # or vllm once migrated
base_url: "http://127.0.0.1:11434"

models:
  reasoning:
    name: "qwen2.5:7b-instruct-q4_K_M"
    role: "general_reasoning_and_planning"
    context_length: 32768
    resident: true
    vram_usage_mb: 4700

  coder:
    name: "qwen2.5-coder:7b-instruct-q4_K_M"
    role: "code_generation_and_execution"
    context_length: 32768
    resident: false
    vram_usage_mb: 4700

  vision:
    name: "moondream"
    fallback_name: "qwen2-vl:7b"
    role: "image_layout_and_diagrams"
    context_length: 8192
    resident: false
    vram_usage_mb: 1700

  embeddings:
    name: "bge-small-en-v1.5"
    device: "cpu"  # FORCED CPU to protect GPU VRAM
```

**Revision — Multi-Objective Model Registry:** expand every model entry with three
additional integer fields normalized 0-100: **Intelligence**, **Reliability**, **Speed**.
Assign realistic relative scores based on architecture/quantization (a larger reasoning
model scores high Intelligence but lower Speed; a smaller quantized model may score high
Speed but lower Intelligence). Base scores on real benchmarks/operational constraints for
the specific models actually loaded — do not invent plausible-looking numbers without
research. Verify the restructured YAML maps cleanly to the schemas the FastAPI
orchestrator and LangGraph router actually expect.

## Step 4 — Kernel-Level Network Isolation and Zero-Egress Proof
**Objective:** enforce air-gapped sovereignty at the OS level and build a live
auditing mechanism proving zero external network calls.

- **Firewall Ruleset:** kernel-level `nftables` (or `iptables`) targeting the outbound
  traffic chain. Default policy: drop all egress packets.
- **Loopback Exceptions:** explicit allow-rules for loopback and trusted internal
  subnets only, so the FastAPI orchestrator ↔ local vLLM ↔ frontend UI can still
  function.
- **Packet Capture:** `tcpdump` on the host's primary external interface, filtering
  out whitelisted local traffic, flagging any external connection attempt.
- **Live Audit Pipeline (`egress_monitor.sh`):**
  ```bash
  #!/usr/bin/env bash
  # infra/egress_monitor.sh
  # Requires root privileges to bind tcpdump to network interfaces.
  INTERFACE=$(ip route | grep default | awk '{print $5}')
  if [ -z "$INTERFACE" ]; then INTERFACE="any"; fi
  echo "Starting Sovereign Egress Monitor on interface: $INTERFACE"
  sudo tcpdump -i "$INTERFACE" -nn "dst not (127.0.0.1 or 192.168.0.0/16 or 10.0.0.0/8)" -l |
  while read -r line; do
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$TIMESTAMP] EGRESS DETECTED: $line" >> /tmp/egress_violations.log
    echo "{\"timestamp\": \"$TIMESTAMP\", \"violation\": \"$line\"}" > /tmp/latest_egress.json
  done
  ```
  Route this output to a structured log or lightweight local socket that the frontend's
  egress-monitor widget can poll, giving a live "0 Outbound Requests" style proof.

## Handover Checklist
- To backend/agent developer: local base URL, verified model IDs, sandbox invocation
  command string.
- To RAG/ingestion developer: confirm embeddings run CPU-only (`device="cpu"`).
- To frontend developer: egress-monitor log path/socket for the UI widget.
- To project tracker: confirm VRAM budget (Step 0.1) and sandbox attack test (Step 1)
  are both complete.
- To presenter: run `egress_monitor.sh` live during a sample inference for the
  zero-egress demo proof.

## Git Version Control & Documentation Workflow
1. **Branch Naming:** `infra/` prefix for all sandboxing, networking, and vLLM tasks —
   e.g. `infra/gvisor-sandbox-setup`, `infra/vllm-prefix-caching`. Never commit directly
   to `main`.
2. **Commit Messages:** Conventional Commits — `<type>(<scope>): <description>`.
   `feat` for new capabilities, `fix` for bugs, `docs` for config notes. Imperative
   mood. Example: `feat(sandbox): register gvisor runsc runtime in docker daemon`.
3. **Documentation:** comment all kernel-level `nftables` rules and Docker daemon
   overrides explaining exactly why a port/interface is whitelisted. Add docstrings to
   `attack_test.py` explaining expected failure modes. Maintain a brief
   `CHANGELOG.md` in `infra/` for major shifts (e.g., Ollama → vLLM).
4. **Pull Requests:** push the isolated branch, open a PR against `main`. Title/
   description must list the exact files altered and the exact terminal commands
   needed to test locally. Require at least one peer review before merge.
