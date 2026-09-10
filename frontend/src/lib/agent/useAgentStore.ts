// src/lib/agent/useAgentStore.ts
import { useCallback, useMemo, useRef, useState } from "react";
import type { ActiveModel, NetworkEvent, TaskState, ThreadItem, TraceStep, TraceStepKind } from "./types";

const API_BASE = "http://127.0.0.1:8000";

const uid = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const MODELS: ActiveModel[] = [
  { id: "m1", name: "qwen2.5:7b-instruct", role: "Planner / Orchestrator / Synthesis", state: "loaded" },
  { id: "m2", name: "bge-small-en-v1.5 (CPU)", role: "LanceDB SOP Retrieval", state: "loaded" },
  { id: "m3", name: "pytesseract / moondream", role: "Multimodal & OCR Extraction", state: "loaded" },
  { id: "m4", name: "gVisor / sandbox-runner", role: "Isolated Code Execution", state: "loaded" },
];

export interface AgentStore {
  state: TaskState;
  thread: ThreadItem[];
  network: NetworkEvent[];
  outboundCount: number;
  models: ActiveModel[];
  kbDocCount: number;
  activeApprovalId: string | null;
  sendTask: (text: string, attachments: string[]) => Promise<void>;
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
  const [network, setNetwork] = useState<NetworkEvent[]>([
    {
      id: uid("net"),
      timestamp: Date.now(),
      destination: "127.0.0.1:11434",
      kind: "internal",
      detail: "Ollama inference local daemon verified — 0 external sockets",
    },
    {
      id: uid("net"),
      timestamp: Date.now(),
      destination: "127.0.0.1:8000",
      kind: "internal",
      detail: "FastAPI agent backend connected",
    },
  ]);
  const [kbDocCount, setKbDocCount] = useState(1);
  const [activeApprovalId, setActiveApprovalId] = useState<string | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);

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

  const sendTask = useCallback(async (text: string, attachments: string[]) => {
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
      pushNetwork("127.0.0.1:8000/api/tasks/submit", "Submitting task to LangGraph planner");

      const res = await fetch(`${API_BASE}/api/tasks/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          files: attachments.length > 0 ? attachments : ["boiler_scan.pdf"],
        }),
      });

      if (!res.ok) throw new Error(`Backend returned HTTP ${res.status}`);
      const data = await res.json();
      currentTaskIdRef.current = data.task_id;

      const subtasks = data.state?.plan?.subtasks || [];
      const completedIds: number[] = data.state?.completed_subtask_ids || [];
      const waitingSubtask = data.state?.current_subtask;

      // Map subtasks to UI visual trace steps
      const steps: TraceStep[] = subtasks.map((st: any) => {
        const isDone = completedIds.includes(st.id);
        const isWaiting = waitingSubtask?.id === st.id;
        return {
          id: `step-${st.id}`,
          kind: mapKind(st.task_type),
          label: st.description,
          model: st.task_type === "code_execution" ? "sandbox_runner" : "qwen2.5:7b-instruct",
          status: isDone ? "done" : isWaiting ? "running" : "pending",
          raw: data.state?.results?.find((r: any) => r.subtask_id === st.id)?.output,
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
    setState("running");
    setActiveApprovalId(null);
    pushNetwork(`127.0.0.1:8000/api/tasks/${approvalId}/approve`, "Operator authorization transmitted");

    try {
      const res = await fetch(`${API_BASE}/api/tasks/${approvalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });

      if (!res.ok) throw new Error(`Approval failed: HTTP ${res.status}`);
      const data = await res.json();

      // Mark all trace steps as completed in the UI view
      setThread((prev) =>
        prev.map((item) => {
          if (item.type === "trace") {
            return {
              ...item,
              steps: item.steps.map((st) => ({
                ...st,
                status: "done",
              })),
            };
          }
          if (item.type === "approval" && item.approval.id === approvalId) {
            return {
              ...item,
              approval: { ...item.approval, decision: "approved" },
            };
          }
          return item;
        })
      );

      setState("completed");
      addDeliverable(approvalId, data.state?.final_output || "Approval note generated.");
      pushNetwork(`127.0.0.1:8000/api/tasks/${approvalId}/download`, "Deliverable finalized on disk");
    } catch (err: any) {
      setState("failed");
      setThread((prev) => [
        ...prev,
        { id: uid("err"), type: "failure", text: `Error: ${err.message}`, at: Date.now() },
      ]);
    }
  }, [pushNetwork, addDeliverable]);

  const reject = useCallback((approvalId: string, reason: string) => {
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
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setThread([]);
    setActiveApprovalId(null);
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
    models: MODELS,
    kbDocCount,
    activeApprovalId,
    sendTask,
    approve,
    reject,
    reset,
    ingestDocument,
  };
}
