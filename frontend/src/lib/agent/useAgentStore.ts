// src/lib/agent/useAgentStore.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveModel, GenerationMetrics, NetworkEvent, TaskState, ThreadItem, TraceStep, TraceStepKind } from "./types";

const API_BASE = "http://127.0.0.1:8000";

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("lex_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const INITIAL_METRICS: GenerationMetrics = {
  elapsedMs: 0,
  currentStep: "",
  currentNode: "",
  totalTokensIn: 0,
  totalTokensOut: 0,
  tokensPerSecond: 0,
  isRunning: false,
};

export interface AgentStore {
  state: TaskState;
  thread: ThreadItem[];
  network: NetworkEvent[];
  outboundCount: number;
  models: ActiveModel[];
  kbDocCount: number;
  activeApprovalId: string | null;
  metrics: GenerationMetrics;
  sendTask: (text: string, attachments: string[], files?: File[]) => Promise<void>;
  approve: (approvalId: string) => Promise<void>;
  reject: (approvalId: string, reason: string) => void;
  reset: () => void;
  ingestDocument: () => void;
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

export function useAgentStore(): AgentStore {
  const [state, setState] = useState<TaskState>("idle");
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [network, setNetwork] = useState<NetworkEvent[]>([]);
  const [models, setModels] = useState<ActiveModel[]>([]);
  const [kbDocCount, setKbDocCount] = useState(1);
  const [activeApprovalId, setActiveApprovalId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<GenerationMetrics>(INITIAL_METRICS);
  const currentTaskIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // ── Elapsed timer management ─────────────────────────────────────
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    setMetrics((m) => ({ ...m, isRunning: true, elapsedMs: 0 }));
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setMetrics((m) => ({
        ...m,
        elapsedMs: Date.now() - startTimeRef.current,
      }));
    }, 100);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setMetrics((m) => ({
      ...m,
      isRunning: false,
      elapsedMs: Date.now() - startTimeRef.current,
    }));
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
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
    const interval = setInterval(poll, 3000);
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

  // ── SSE-based streaming task submission ───────────────────────────
  const sendTaskStreaming = useCallback(async (text: string, attachments: string[], files?: File[]) => {
    setState("running");
    startTimer();
    setMetrics((m) => ({
      ...m,
      currentStep: "Initializing...",
      currentNode: "",
      totalTokensIn: 0,
      totalTokensOut: 0,
      tokensPerSecond: 0,
    }));

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

      pushNetwork("127.0.0.1:8000/api/tasks/submit/stream", "Opening SSE stream to LangGraph agent");

      const res = await fetch(`${API_BASE}/api/tasks/submit/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          prompt: text,
          files: uploadedFilenames.length > 0 ? uploadedFilenames : ["boiler_scan.pdf"],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Backend returned HTTP ${res.status}`);
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6).trim();

            if (eventType && eventData) {
              try {
                const data = JSON.parse(eventData);
                handleSSEEvent(eventType, data);
              } catch {
                // Skip malformed JSON
              }
              eventType = "";
              eventData = "";
            }
          }
        }
      }
    } catch (err: any) {
      stopTimer();
      setState("failed");
      setThread((prev) => [
        ...prev,
        { id: uid("err"), type: "failure", text: `Connection error: ${err.message}`, at: Date.now() },
      ]);
    }
  }, [pushNetwork, startTimer, stopTimer]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  function handleSSEEvent(eventType: string, data: any) {
    switch (eventType) {
      case "task_started":
        currentTaskIdRef.current = data.task_id;
        setMetrics((m) => ({ ...m, currentStep: "Classifying intent...", currentNode: "init" }));
        break;

      case "intent_classified": {
        const label = data.intent === "conversational"
          ? "Conversational mode — generating response..."
          : "Agentic mode — launching pipeline...";
        setMetrics((m) => ({
          ...m,
          currentStep: label,
          currentNode: data.intent,
        }));
        pushNetwork("127.0.0.1:8000", `Intent: ${data.intent} (${data.method}, conf=${data.confidence})`);
        break;
      }

      case "step_start":
        setMetrics((m) => ({
          ...m,
          currentStep: data.description || `Running ${data.node}...`,
          currentNode: data.node || "",
        }));
        pushNetwork("127.0.0.1:8000", `Node: ${data.node} — ${data.description}`);
        break;

      case "step_complete": {
        const m = data.metrics;
        if (m) {
          setMetrics((prev) => ({
            ...prev,
            totalTokensIn: m.total_tokens_in ?? prev.totalTokensIn,
            totalTokensOut: m.total_tokens_out ?? prev.totalTokensOut,
            tokensPerSecond: m.last_eval_tps ?? m.avg_tokens_per_sec ?? prev.tokensPerSecond,
          }));
        }
        break;
      }

      case "token_delta": {
        const token = data.token;
        if (!token) break;
        setThread((prev) => {
          const last = prev[prev.length - 1];
          if (last?.type === "streaming" && !last.isComplete) {
            // Append token to existing streaming item
            return [
              ...prev.slice(0, -1),
              { ...last, text: last.text + token },
            ];
          }
          // First token — create new streaming item
          return [
            ...prev,
            { id: uid("stream"), type: "streaming" as const, text: token, isComplete: false, at: Date.now() },
          ];
        });
        // Update status bar to show "Generating response..."
        setMetrics((m) => ({
          ...m,
          currentStep: "Generating response...",
        }));
        break;
      }

      case "token_done": {
        // Convert streaming item to a finalized response
        const fullText = data.full_text;
        if (fullText) {
          setThread((prev) => {
            const last = prev[prev.length - 1];
            if (last?.type === "streaming") {
              // Replace streaming item with final response
              return [
                ...prev.slice(0, -1),
                { id: last.id, type: "response" as const, text: fullText, at: last.at },
              ];
            }
            // No streaming item found — just add the response
            return [
              ...prev,
              { id: uid("resp"), type: "response" as const, text: fullText, at: Date.now() },
            ];
          });
        }
        // Update metrics from token_done
        if (data.metrics) {
          setMetrics((prev) => ({
            ...prev,
            totalTokensIn: data.metrics.total_tokens_in ?? prev.totalTokensIn,
            totalTokensOut: data.metrics.total_tokens_out ?? prev.totalTokensOut,
            tokensPerSecond: data.metrics.avg_tokens_per_sec ?? data.metrics.last_eval_tps ?? prev.tokensPerSecond,
          }));
        }
        break;
      }

      case "approval_required": {
        stopTimer();
        setState("approval_required");
        setActiveApprovalId(data.task_id);
        setMetrics((m) => ({ ...m, currentStep: "Awaiting human approval...", isRunning: false }));

        // Add trace steps from state
        const stateData = data.state;
        if (stateData) {
          const subtasks = stateData.plan?.subtasks || [];
          const completedIds: number[] = stateData.completed_subtask_ids || [];
          const results = stateData.results || [];
          const waitingSubtask = stateData.current_subtask;

          const steps: TraceStep[] = subtasks.map((st: any) => {
            const isDone = completedIds.includes(st.id);
            const isWaiting = waitingSubtask?.id === st.id;
            const resultEntry = results.find((r: any) => r.subtask_id === st.id);
            return {
              id: `step-${st.id}`,
              kind: mapKind(st.task_type),
              label: st.description,
              model: resultEntry?.model_used || (st.task_type === "code_execution" ? "qwen2.5-coder:7b → sandbox" : "qwen2.5:7b-instruct"),
              status: isDone ? "done" : isWaiting ? "running" : "pending",
              raw: resultEntry?.output,
            };
          });

          setThread((prev) => [
            ...prev,
            { id: uid("trace"), type: "trace", steps, at: Date.now() },
          ]);

          // Add approval card
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
        }
        break;
      }

      case "response_text":
        if (data.text) {
          setThread((prev) => [
            ...prev,
            { id: uid("resp"), type: "response", text: data.text, at: Date.now() },
          ]);
        }
        break;

      case "deliverable_ready": {
        const stateData = data.state;
        if (stateData) {
          // Add trace steps
          const subtasks = stateData.plan?.subtasks || [];
          const completedIds: number[] = stateData.completed_subtask_ids || [];
          const results = stateData.results || [];

          const steps: TraceStep[] = subtasks.map((st: any) => {
            const resultEntry = results.find((r: any) => r.subtask_id === st.id);
            return {
              id: `step-${st.id}`,
              kind: mapKind(st.task_type),
              label: st.description,
              model: resultEntry?.model_used || "qwen2.5:7b-instruct",
              status: completedIds.includes(st.id) ? "done" : "pending",
              raw: resultEntry?.output,
            };
          });

          setThread((prev) => [
            ...prev,
            { id: uid("trace"), type: "trace", steps, at: Date.now() },
          ]);

          addDeliverable(data.task_id, stateData.final_output || "Report generated.");
        }

        // Update final metrics
        if (data.metrics) {
          setMetrics((prev) => ({
            ...prev,
            totalTokensIn: data.metrics.total_tokens_in ?? prev.totalTokensIn,
            totalTokensOut: data.metrics.total_tokens_out ?? prev.totalTokensOut,
            tokensPerSecond: data.metrics.avg_tokens_per_sec ?? data.metrics.last_eval_tps ?? prev.tokensPerSecond,
          }));
        }
        break;
      }

      case "done":
        stopTimer();
        // Finalize any in-progress streaming items
        setThread((prev) =>
          prev.map((item) => {
            if (item.type === "streaming" && !item.isComplete) {
              return { ...item, isComplete: true };
            }
            return item;
          })
        );
        if (data.status === "completed") {
          setState("completed");
          setMetrics((m) => ({ ...m, currentStep: "Complete", isRunning: false }));
        }
        break;

      case "error":
        stopTimer();
        setState("failed");
        setThread((prev) => [
          ...prev,
          { id: uid("err"), type: "failure", text: `Agent error: ${data.message}`, at: Date.now() },
        ]);
        break;
    }
  }

  // ── Fallback REST-based task submission ───────────────────────────
  const sendTaskRest = useCallback(async (text: string, attachments: string[], files?: File[]) => {
    setState("running");
    startTimer();
    setMetrics((m) => ({
      ...m,
      currentStep: "Submitting task...",
      currentNode: "submit",
      totalTokensIn: 0,
      totalTokensOut: 0,
      tokensPerSecond: 0,
    }));

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
          files: uploadedFilenames.length > 0 ? uploadedFilenames : ["boiler_scan.pdf"],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
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
          model: resultEntry?.model_used || st.task_type === "code_execution" ? "qwen2.5-coder:7b → sandbox" : "qwen2.5:7b-instruct",
          status: isDone ? "done" : isWaiting ? "running" : "pending",
          raw: resultEntry?.output,
        };
      });

      setThread((prev) => [
        ...prev,
        { id: uid("trace"), type: "trace", steps, at: Date.now() },
      ]);

      // Update metrics from REST response
      const genMetrics = data.state?.generation_metrics;
      if (genMetrics) {
        setMetrics((prev) => ({
          ...prev,
          totalTokensIn: genMetrics.total_tokens_in ?? 0,
          totalTokensOut: genMetrics.total_tokens_out ?? 0,
          tokensPerSecond: genMetrics.avg_tokens_per_sec ?? genMetrics.last_eval_tps ?? 0,
        }));
      }

      if (data.status === "waiting_approval") {
        stopTimer();
        setState("approval_required");
        setActiveApprovalId(data.task_id);
        setMetrics((m) => ({ ...m, currentStep: "Awaiting human approval...", isRunning: false }));
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
        stopTimer();
        setState("completed");
        setMetrics((m) => ({ ...m, currentStep: "Complete", isRunning: false }));

        // Add conversational response if available
        const responseText = data.state?.response_text;
        if (responseText) {
          setThread((prev) => [
            ...prev,
            { id: uid("resp"), type: "response", text: responseText, at: Date.now() },
          ]);
        }

        addDeliverable(data.task_id, data.state?.final_output || "Report generated.");
      }
    } catch (err: any) {
      stopTimer();
      setState("failed");
      setThread((prev) => [
        ...prev,
        { id: uid("err"), type: "failure", text: `Connection error: ${err.message}`, at: Date.now() },
      ]);
    }
  }, [pushNetwork, addDeliverable, startTimer, stopTimer]);

  // ── Smart sendTask: try SSE first, fallback to REST ──────────────
  const sendTask = useCallback(async (text: string, attachments: string[], files?: File[]) => {
    try {
      await sendTaskStreaming(text, attachments, files);
    } catch {
      // SSE failed entirely, fall back to REST
      await sendTaskRest(text, attachments, files);
    }
  }, [sendTaskStreaming, sendTaskRest]);

  const approve = useCallback(async (approvalId: string) => {
    // ── Instant UI feedback ─────────────────────────────────────────
    setState("running");
    startTimer();
    setActiveApprovalId(null);
    setMetrics((m) => ({ ...m, currentStep: "Resuming after approval...", isRunning: true }));

    // Immediately mark the approval card as decided BEFORE the API call
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

    // Add a processing indicator to the thread
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

    // ── Try SSE streaming approval resume ───────────────────────────
    try {
      const res = await fetch(`${API_BASE}/api/tasks/${approvalId}/approve/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ approved: true }),
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ") && eventType) {
              try {
                const data = JSON.parse(line.slice(6).trim());
                handleSSEEvent(eventType, data);
              } catch { /* skip */ }
              eventType = "";
            }
          }
        }

        // Mark processing trace as done
        setThread((prev) =>
          prev.map((item) => {
            if (item.type === "trace") {
              return {
                ...item,
                steps: item.steps.map((st) => ({
                  ...st,
                  status: "done" as const,
                  ...(st.id === "proc-exec" ? { label: "Subtask execution complete ✓" } : {}),
                })),
              };
            }
            return item;
          })
        );
        return;
      }
    } catch {
      // SSE approve failed, fall back to REST approve
    }

    // ── Fallback REST approval ──────────────────────────────────────
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

      // Mark ALL trace steps as done
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

      stopTimer();
      setState("completed");
      setMetrics((m) => ({ ...m, currentStep: "Complete", isRunning: false }));

      // Add conversational response if available
      const responseText = data.state?.response_text;
      if (responseText) {
        setThread((prev) => [
          ...prev,
          { id: uid("resp"), type: "response", text: responseText, at: Date.now() },
        ]);
      }

      // Update metrics
      const genMetrics = data.state?.generation_metrics;
      if (genMetrics) {
        setMetrics((prev) => ({
          ...prev,
          totalTokensIn: genMetrics.total_tokens_in ?? 0,
          totalTokensOut: genMetrics.total_tokens_out ?? 0,
          tokensPerSecond: genMetrics.avg_tokens_per_sec ?? genMetrics.last_eval_tps ?? 0,
        }));
      }

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
      stopTimer();
      setState("failed");
      setThread((prev) => [
        ...prev,
        { id: uid("err"), type: "failure", text: `Error: ${err.message}`, at: Date.now() },
      ]);
    }
  }, [pushNetwork, addDeliverable, startTimer, stopTimer]);

  const reject = useCallback((approvalId: string, reason: string) => {
    setState("idle");
    setActiveApprovalId(null);
    stopTimer();
    setMetrics(INITIAL_METRICS);
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
  }, [stopTimer]);

  const reset = useCallback(() => {
    setState("idle");
    setThread([]);
    setActiveApprovalId(null);
    stopTimer();
    setMetrics(INITIAL_METRICS);
  }, [stopTimer]);

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
    metrics,
    sendTask,
    approve,
    reject,
    reset,
    ingestDocument,
  };
}
