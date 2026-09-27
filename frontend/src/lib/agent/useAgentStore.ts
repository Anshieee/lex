// src/lib/agent/useAgentStore.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveModel, NetworkEvent, TaskState, ThreadItem, TraceStep, TraceStepKind, RoutingWeights, PromptCompressionConfig } from "./types";

const API_BASE = "http://127.0.0.1:8000";

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("lex_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export interface AgentStore {
  state: TaskState;
  thread: ThreadItem[];
  network: NetworkEvent[];
  outboundCount: number;
  models: ActiveModel[];
  kbDocCount: number;
  activeApprovalId: string | null;
  routingWeights: RoutingWeights;
  promptCompression: PromptCompressionConfig;
  sendTask: (text: string, attachments: string[], files?: File[]) => Promise<void>;
  approve: (approvalId: string) => Promise<void>;
  reject: (approvalId: string, reason: string) => Promise<void>;
  reset: () => void;
  ingestDocument: () => void;
  setRoutingWeights: (weights: RoutingWeights) => void;
  setPromptCompression: (config: PromptCompressionConfig) => void;
}

const mapKind = (type: string): TraceStepKind => {
  switch (type) {
    case "vision_ocr": return "decompose";
    case "rag_retrieval": return "retrieve";
    case "code_execution": return "verify";
    case "general_reasoning": return "generate";
    default: return "route";
  }
};

const extractMode = (taskType: string, modelUsed?: string, output?: string): string | undefined => {
  // code_execution tasks run in sandbox - extract mode from output or model
  if (taskType === "code_execution") {
    if (output && output.includes("[GVSOR_CONTAINER]")) return "gVisor Container";
    if (output && output.includes("[LOCAL_SUBPROCESS_FALLBACK]")) return "Local Subprocess Fallback";
    if (modelUsed?.includes("sandbox")) return "Sandbox Runner";
  }
  return undefined;
};

export function useAgentStore(): AgentStore {
  const [state, setState] = useState<TaskState>("idle");
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [network, setNetwork] = useState<NetworkEvent[]>([]);
  const [models, setModels] = useState<ActiveModel[]>([]);
  const [kbDocCount, setKbDocCount] = useState(1);
  const [activeApprovalId, setActiveApprovalId] = useState<string | null>(null);
  const [routingWeights, setRoutingWeightsState] = useState<RoutingWeights>({
    speed: 33,
    reliability: 33,
    intelligence: 34,
  });
  const [promptCompression, setPromptCompressionState] = useState<PromptCompressionConfig>({
    mode: "Off",
    repeated_blocks: false,
    whitespace_cleanup: false,
    json_tables: false,
    superseded_file_reads: false,
    tool_output_filter: false,
    relevance_filter: false,
    older_turns: false,
    token_ceiling: false,
  });
  const currentTaskIdRef = useRef<string | null>(null);
  const approvalProcessingRef = useRef<Set<string>>(new Set());

  const setRoutingWeights = useCallback((weights: RoutingWeights) => {
    setRoutingWeightsState(weights);
  }, []);

  const setPromptCompression = useCallback((config: PromptCompressionConfig) => {
    setPromptCompressionState(config);
  }, []);

  // ── Fetch real models from backend on mount ──────────────────────
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/models`);
        if (res.ok) {
          const data = await res.json();
          const mapped: ActiveModel[] = data.models.map((m: any) => ({
            id: m.id,
            name: m.ollama_tag,
            role: m.role,
            state: m.state as "loaded" | "idle",
          }));
          setModels(mapped);
        }
      } catch {
        // Backend not reachable yet — use fallback
        setModels([
          { id: "m1", name: "qwen2.5:7b-instruct-q4_K_M", role: "Planner / Orchestrator / Synthesis", state: "loaded" },
          { id: "m2", name: "qwen2.5-coder:7b", role: "Code Generation & Verification", state: "idle" },
          { id: "m3", name: "moondream", role: "Multimodal & OCR Extraction", state: "loaded" },
          { id: "m4", name: "bge-small-en-v1.5 (CPU)", role: "LanceDB SOP Retrieval", state: "loaded" },
          { id: "m5", name: "gVisor / sandbox-runner", role: "Isolated Code Execution", state: "loaded" },
        ]);
      }
    };
    fetchModels();
  }, []);

  // ── Poll real network status every 3s ────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/network/status`);
        if (res.ok) {
          const data = await res.json();
          const events: NetworkEvent[] = (data.connections || []).map((c: any, i: number) => ({
            id: `net-${i}-${Date.now()}`,
            timestamp: Date.now(),
            destination: c.remote,
            kind: c.is_local ? "internal" as const : "outbound" as const,
            detail: `${c.state} → ${c.service || "unknown"} [${c.local} ↔ ${c.remote}]`,
          }));

          // Always include sovereignty summary as first event
          events.unshift({
            id: `sovereign-${Date.now()}`,
            timestamp: Date.now(),
            destination: "SYSTEM",
            kind: "internal" as const,
            detail: data.sovereign
              ? `✓ SOVEREIGN — ${data.local_connections} local, 0 outbound connections`
              : `⚠ WARNING — ${data.outbound_connections} outbound connections detected!`,
          });

          setNetwork(events);
        }
      } catch {
        // Backend not up yet — show initial state
      }
    };

    poll(); // initial fetch
    const interval = setInterval(poll, 15000); // 15s interval per QA recommendation (was 3s)
    return () => clearInterval(interval);
  }, []);

  const pushNetwork = useCallback((destination: string, detail: string) => {
    setNetwork((prev) => [
      {
        id: uid("net"),
        timestamp: Date.now(),
        destination,
        kind: "internal",
        detail,
      },
      ...prev,
    ]);
  }, []);

  const addDeliverable = useCallback((taskId: string, content: string) => {
    setThread((prev) => [
      ...prev,
      {
        id: uid("deliv"),
        type: "deliverable",
        deliverable: {
          id: taskId,
          filename: `Approval_Note_${taskId}.docx`,
          fileType: "docx",
          sizeLabel: "38 KB",
          content: content.slice(0, 450) + "...\n\n[Full deliverable formatted in docx]",
        },
        at: Date.now(),
      },
    ]);
  }, []);

  const sendTask = useCallback(async (text: string, attachments: string[], files?: File[]) => {
    setState("running");
    const userItem: ThreadItem = {
      id: uid("user"),
      type: "user",
      text,
      attachments,
      at: Date.now(),
    };
    setThread((prev) => [...prev, userItem]);

    try {
      // Upload files first if any
      let uploadedFilenames = attachments;
      if (files && files.length > 0) {
        pushNetwork("127.0.0.1:8000/api/files/upload", `Uploading ${files.length} file(s) to backend`);
        const formData = new FormData();
        for (const f of files) {
          formData.append("files", f);
        }
        const uploadRes = await fetch(`${API_BASE}/api/files/upload`, {
          method: "POST",
          headers: { ...getAuthHeaders() },
          body: formData,
        });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          uploadedFilenames = uploadData.uploaded.map((u: any) => u.filename);
        }
      }

      pushNetwork("127.0.0.1:8000/api/tasks/submit", "Submitting task to LangGraph planner");

      const res = await fetch(`${API_BASE}/api/tasks/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          prompt: text,
          files: uploadedFilenames,
          routing_weights: routingWeights,
          prompt_compression: promptCompression,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        // Provide clear error if no files and task needs them
        if (errData.detail && errData.detail.includes("No valid file found")) {
          throw new Error("No files uploaded. Please upload a document (PDF/image) before submitting a vision_ocr task.");
        }
        throw new Error(errData.detail || `Backend returned HTTP ${res.status}`);
      }
      const data = await res.json();
      currentTaskIdRef.current = data.task_id;

      const subtasks = data.state?.plan?.subtasks || [];
      const completedIds: number[] = data.state?.completed_subtask_ids || [];
      const waitingSubtask = data.state?.current_subtask;
      const results = data.state?.results || [];

      // Map subtasks to UI visual trace steps — include actual model used
      const steps: TraceStep[] = subtasks.map((st: any) => {
        const isDone = completedIds.includes(st.id);
        const isWaiting = waitingSubtask?.id === st.id;
        const resultEntry = results.find((r: any) => r.subtask_id === st.id);
        return {
          id: `step-${st.id}`,
          kind: mapKind(st.task_type),
          label: st.description,
          model: resultEntry?.model_used || (st.task_type === "code_execution" ? "qwen2.5:7b → sandbox" : "qwen2.5:7b"),
          mode: extractMode(st.task_type, resultEntry?.model_used, resultEntry?.output),
          status: isDone ? "done" : isWaiting ? "running" : "pending",
          raw: resultEntry?.output,
        };
      });

      setThread((prev) => [
        ...prev,
        { id: uid("trace"), type: "trace", steps, at: Date.now() },
      ]);

      if (data.status === "waiting_approval") {
        setState("approval_required");
        setActiveApprovalId(data.task_id);
        pushNetwork("127.0.0.1:8000", `HITL Interrupt: Halted before ${waitingSubtask?.description || "subtask"}`);

        setThread((prev) => [
          ...prev,
          {
            id: uid("appr"),
            type: "approval",
            approval: {
              id: data.task_id,
              action: `Authorize ${waitingSubtask?.task_type || "execution"}`,
              detail: `Subtask #${waitingSubtask?.id}: ${waitingSubtask?.description}. Requires human sign-off before running inside sandbox.`,
            },
            at: Date.now(),
          },
        ]);
      } else if (data.status === "completed") {
        setState("completed");
        addDeliverable(data.task_id, data.state?.final_output || "Report generated.");
      }
    } catch (err: any) {
      setState("failed");
      setThread((prev) => [
        ...prev,
        { id: uid("err"), type: "failure", text: `Connection error: ${err.message}`, at: Date.now() },
      ]);
    }
  }, [pushNetwork, addDeliverable]);

  const approve = useCallback(async (approvalId: string) => {
    // Prevent duplicate submissions - idempotency guard
    if (approvalProcessingRef.current.has(approvalId)) {
      return; // Already processing this approval
    }
    approvalProcessingRef.current.add(approvalId);

    // ── Instant UI feedback ─────────────────────────────────────────
    // Update state and mark approval card as decided BEFORE the API call
    setState("running");
    setActiveApprovalId(null);

    // Immediately mark the approval card as "approved" in the thread
    setThread((prev) =>
      prev.map((item) => {
        if (item.type === "approval" && item.approval.id === approvalId) {
          return {
            ...item,
            approval: { ...item.approval, decision: "approved" },
          };
        }
        return item;
      })
    );

    // Add a processing indicator to the thread so user knows work is happening
    const processingId = uid("processing");
    setThread((prev) => [
      ...prev,
      {
        id: processingId,
        type: "trace",
        steps: [
          {
            id: "proc-auth",
            kind: "route" as const,
            label: "Operator approval confirmed ✓",
            model: "system",
            status: "done" as const,
          },
          {
            id: "proc-exec",
            kind: "generate" as const,
            label: "Executing approved subtask — generating deliverable…",
            model: "qwen2.5:7b-instruct",
            status: "running" as const,
          },
        ],
        at: Date.now(),
      },
    ]);

    pushNetwork(`127.0.0.1:8000/api/tasks/${approvalId}/approve`, "Operator authorization transmitted");

    // ── Background API call ─────────────────────────────────────────
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${approvalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ approved: true }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Approval failed: HTTP ${res.status}`);
      }
      const data = await res.json();

      // Mark ALL trace steps (including the processing indicator) as done
      setThread((prev) =>
        prev.map((item) => {
          if (item.type === "trace") {
            return {
              ...item,
              steps: item.steps.map((st) => ({
                ...st,
                status: "done" as const,
                ...(st.id === "proc-exec"
                  ? { label: "Subtask execution complete ✓" }
                  : {}),
              })),
            };
          }
          return item;
        })
      );

      setState("completed");
      addDeliverable(approvalId, data.state?.final_output || "Approval note generated.");
      pushNetwork(`127.0.0.1:8000/api/tasks/${approvalId}/download`, "Deliverable finalized on disk");
    } catch (err: any) {
      // Mark the processing step as failed instead of spinning forever
      setThread((prev) =>
        prev.map((item) => {
          if (item.id === processingId && item.type === "trace") {
            return {
              ...item,
              steps: item.steps.map((st) =>
                st.id === "proc-exec"
                  ? { ...st, status: "done" as const, label: `Execution failed: ${(err as Error).message}` }
                  : st
              ),
            };
          }
          return item;
        })
      );
      setState("failed");
      setThread((prev) => [
        ...prev,
        { id: uid("err"), type: "failure", text: `Error: ${err.message}`, at: Date.now() },
      ]);
    } finally {
      approvalProcessingRef.current.delete(approvalId);
    }
  }, [pushNetwork, addDeliverable]);

  const reject = useCallback(async (approvalId: string, reason: string) => {
    // Prevent duplicate submissions
    if (approvalProcessingRef.current.has(approvalId)) {
      return;
    }
    approvalProcessingRef.current.add(approvalId);

    // ── Instant UI feedback ─────────────────────────────────────────
    setState("idle");
    setActiveApprovalId(null);
    setThread((prev) =>
      prev.map((item) => {
        if (item.type === "approval" && item.approval.id === approvalId) {
          return {
            ...item,
            approval: { ...item.approval, decision: "rejected", reason },
          };
        }
        return item;
      })
    );

    // Notify backend to release the checkpoint
    pushNetwork(`127.0.0.1:8000/api/tasks/${approvalId}/approve`, `Operator rejected: ${reason}`);

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${approvalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ approved: false }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Reject failed: HTTP ${res.status}`);
      }
      // Backend will mark task as rejected and resume to END
    } catch (err: any) {
      setThread((prev) => [
        ...prev,
        { id: uid("err"), type: "failure", text: `Reject notification failed: ${err.message}`, at: Date.now() },
      ]);
    } finally {
      approvalProcessingRef.current.delete(approvalId);
    }
  }, [pushNetwork]);

  const reset = useCallback(() => {
    setState("idle");
    setThread([]);
    setActiveApprovalId(null);
    approvalProcessingRef.current.clear();
  }, []);

  const ingestDocument = useCallback(() => {
    setKbDocCount((c) => c + 1);
  }, []);

  const outboundCount = useMemo(
    () => network.filter((n) => n.kind === "outbound").length,
    [network]
  );

  return {
    state,
    thread,
    network,
    outboundCount,
    models,
    kbDocCount,
    activeApprovalId,
    routingWeights,
    promptCompression,
    sendTask,
    approve,
    reject,
    reset,
    ingestDocument,
    setRoutingWeights,
    setPromptCompression,
  };
}
