import type { AgentEvent, Deliverable, NetworkEvent, TraceStep } from "./types";

let counter = 0;
const uid = (p: string) => `${p}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;

export interface MockOptions {
  requireApproval?: boolean;
  shouldFail?: boolean;
  /** delays scaled by this factor (1 = normal demo pacing) */
  speed?: number;
}

const mkStep = (kind: TraceStep["kind"], label: string, model: string, status: TraceStep["status"] = "pending"): TraceStep => ({
  id: uid("step"),
  kind,
  label,
  model,
  status,
});

const rawFor = (s: TraceStep) =>
  [
    `[${new Date().toISOString()}] model=${s.model ?? "local"}`,
    `step=${s.kind} label="${s.label}"`,
    `tokens_in=${120 + Math.floor(Math.random() * 400)} tokens_out=${80 + Math.floor(Math.random() * 300)}`,
    `latency_ms=${180 + Math.floor(Math.random() * 900)}`,
    `result: OK — output staged for next step`,
  ].join("\n");

interface Ctx {
  emit: (e: AgentEvent) => void;
  at: (ms: number, fn: () => void) => void;
}

function mkCtx(emit: (e: AgentEvent) => void, speed: number): { ctx: Ctx; cancel: () => void } {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const ctx: Ctx = {
    emit,
    at: (ms, fn) => timers.push(setTimeout(fn, ms * speed)),
  };
  return { ctx, cancel: () => timers.forEach(clearTimeout) };
}

const net = (ctx: Ctx, destination: string, detail: string, kind: NetworkEvent["kind"] = "internal") =>
  ctx.emit({
    type: "network_update",
    event: { id: uid("net"), timestamp: Date.now(), destination, kind, detail },
  });

/** Schedule the generation → verify → package tail, then the deliverable. */
function scheduleFinish(ctx: Ctx, base: number) {
  const s4 = mkStep("generate", "Draft deliverable content", "writer-14b (local)");
  const s5 = mkStep("verify", "Verify output against constraints", "critic-8b (local)");
  const s6 = mkStep("package", "Package .docx deliverable", "orchestrator-70b (local)");

  ctx.at(base + 400, () => ctx.emit({ type: "trace_step", step: { ...s4, status: "running" } }));
  ctx.at(base + 1600, () => {
    net(ctx, "127.0.0.1:11434", "POST /api/generate (writer) — loopback only");
    ctx.emit({ type: "trace_update", id: s4.id, status: "done", raw: rawFor(s4) });
    ctx.emit({ type: "trace_step", step: { ...s5, status: "running" } });
  });
  ctx.at(base + 2600, () => {
    ctx.emit({ type: "trace_update", id: s5.id, status: "done", raw: rawFor(s5) });
    ctx.emit({ type: "trace_step", step: { ...s6, status: "running" } });
  });
  ctx.at(base + 3600, () => {
    ctx.emit({ type: "trace_update", id: s6.id, status: "done", raw: rawFor(s6) });
    const deliverable: Deliverable = {
      id: uid("doc"),
      filename: "agent-deliverable.docx",
      fileType: "docx",
      sizeLabel: "~12 KB",
      content:
        "SIH Multi-Model Agent Deliverable\n\nThis document was generated locally by the multi-model agent system. Orchestrator, planner, retriever, writer and verifier models collaborated on-device; the network monitor confirms zero outbound external connections during the run.",
    };
    ctx.emit({ type: "deliverable", deliverable });
  });
  ctx.at(base + 4200, () => {
    ctx.emit({ type: "agent_message", text: "Task complete. Deliverable is ready for download above." });
    ctx.emit({ type: "task_completed" });
  });
}

/**
 * Mock event engine — reproduces the full SIH judging sequence without a backend.
 * Emits a timed stream of AgentEvents; swap for an SSE/WebSocket adapter later
 * (the UI only depends on the AgentEvent union).
 */
export function runMockTask(
  taskText: string,
  emit: (e: AgentEvent) => void,
  opts: MockOptions = {},
): () => void {
  const { requireApproval = true, shouldFail = false, speed = 1 } = opts;
  const { ctx, cancel } = mkCtx(emit, speed);

  const s1 = mkStep("route", "Route task to orchestrator", "orchestrator-70b (local)");
  const s2 = mkStep("decompose", "Decompose into sub-tasks", "planner-8b (local)");
  const s3 = mkStep("retrieve", "Retrieve knowledge-base context", "embed-nomic (local)");

  ctx.at(0, () => {
    ctx.emit({ type: "task_started", text: taskText });
    net(ctx, "127.0.0.1:11434", "POST /api/generate (orchestrator) — loopback only");
  });
  ctx.at(400, () =>
    ctx.emit({ type: "agent_message", text: "Task received. Routing across specialist models — no external calls will be made." }),
  );
  ctx.at(800, () => ctx.emit({ type: "trace_step", step: { ...s1, status: "running" } }));
  ctx.at(1600, () => {
    ctx.emit({ type: "trace_update", id: s1.id, status: "done", raw: rawFor(s1) });
    ctx.emit({ type: "trace_step", step: { ...s2, status: "running" } });
  });
  ctx.at(2600, () => {
    ctx.emit({ type: "trace_update", id: s2.id, status: "done", raw: rawFor(s2) });
    net(ctx, "127.0.0.1:11434", "POST /api/generate (planner) — loopback only");
    ctx.emit({ type: "trace_step", step: { ...s3, status: "running" } });
  });
  ctx.at(3600, () => ctx.emit({ type: "trace_update", id: s3.id, status: "done", raw: rawFor(s3) }));

  if (shouldFail) {
    const s4 = mkStep("generate", "Draft deliverable content", "writer-14b (local)");
    ctx.at(4400, () => ctx.emit({ type: "trace_step", step: { ...s4, status: "running" } }));
    ctx.at(5400, () => {
      ctx.emit({
        type: "trace_update",
        id: s4.id,
        status: "failed",
        raw: "writer-14b: context window exceeded\nstage aborted by orchestrator",
      });
      ctx.emit({
        type: "task_failed",
        reason:
          "Generation step failed: writer-14b exceeded its context window. The task was halted before any deliverable was produced.",
      });
    });
    return cancel;
  }

  if (requireApproval) {
    ctx.at(4400, () =>
      ctx.emit({
        type: "approval_required",
        approval: {
          id: uid("appr"),
          action: "Generate and package the final deliverable document",
          detail:
            "The agent has finished planning and retrieval. The next step will run the writer and verifier models and produce a .docx file on this machine. No data leaves the device.",
        },
      }),
    );
    return cancel;
  }

  scheduleFinish(ctx, 4400);
  return cancel;
}

/** Called when an approval checkpoint is approved — continues the mock run. */
export function continueMockTask(emit: (e: AgentEvent) => void, speed = 1): () => void {
  const { ctx, cancel } = mkCtx(emit, speed);
  ctx.at(0, () => ctx.emit({ type: "agent_message", text: "Approval granted. Continuing with generation." }));
  scheduleFinish(ctx, 0);
  return cancel;
}

/** Backend adapter seam: replace runMockTask/continueMockTask with SSE/WebSocket events emitting the same AgentEvent union. */
export const ADAPTER_NOTE =
  "UI consumes AgentEvent only. To go live, open an SSE/WebSocket to the Role 1 orchestrator and translate its events into AgentEvent.";
