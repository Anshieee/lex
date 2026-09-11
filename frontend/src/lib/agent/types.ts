export type TaskState = "idle" | "running" | "approval_required" | "failed" | "completed";

export type TraceStatus = "pending" | "running" | "done" | "failed";

export type TraceStepKind = "route" | "decompose" | "retrieve" | "generate" | "verify" | "package";

export interface TraceStep {
  id: string;
  kind: TraceStepKind;
  label: string;
  model?: string;
  status: TraceStatus;
  raw?: string;
  startedAt?: number;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  detail: string;
  decision?: "approved" | "rejected";
  reason?: string;
}

export interface Deliverable {
  id: string;
  filename: string;
  fileType: "docx" | "pdf" | "txt" | "xlsx";
  sizeLabel: string;
  content: string;
  /** Optional secondary deliverable (e.g. xlsx alongside docx) */
  secondaryUrl?: string;
  secondaryFilename?: string;
}

export interface NetworkEvent {
  id: string;
  timestamp: number;
  destination: string;
  kind: "internal" | "outbound";
  detail: string;
}

export interface ActiveModel {
  id: string;
  name: string;
  role: string;
  state: "loaded" | "idle" | "unavailable";
}

export type ThreadItem =
  | { id: string; type: "user"; text: string; attachments: string[]; at: number }
  | { id: string; type: "agent"; text: string; at: number }
  | { id: string; type: "trace"; steps: TraceStep[]; at: number }
  | { id: string; type: "approval"; approval: ApprovalRequest; at: number }
  | { id: string; type: "deliverable"; deliverable: Deliverable; at: number }
  | { id: string; type: "failure"; text: string; at: number };

export type AgentEvent =
  | { type: "task_started"; text: string }
  | { type: "agent_message"; text: string }
  | { type: "trace_step"; step: TraceStep }
  | { type: "trace_update"; id: string; status: TraceStatus; raw?: string }
  | { type: "approval_required"; approval: ApprovalRequest }
  | { type: "network_update"; event: NetworkEvent }
  | { type: "deliverable"; deliverable: Deliverable }
  | { type: "task_failed"; reason: string }
  | { type: "task_completed" };
