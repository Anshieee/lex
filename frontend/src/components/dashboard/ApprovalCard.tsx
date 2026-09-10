import { useState } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import type { ApprovalRequest } from "@/lib/agent/types";

export function ApprovalCard({
  approval,
  onApprove,
  onReject,
}: {
  approval: ApprovalRequest;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const decided = Boolean(approval.decision);

  return (
    <section
      aria-label="Approval checkpoint"
      className={`panel-raised border-warn/45 p-4 ${decided ? "" : "approval-halo"}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-warn" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-warn">Approval required</h3>
          <p className="mt-1 text-sm text-foreground">{approval.action}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{approval.detail}</p>

          {decided ? (
            <p className="mt-3 rounded border border-border bg-background/60 px-2.5 py-2 text-xs">
              {approval.decision === "approved" ? (
                <span className="text-ok">Approved by operator — execution resumed.</span>
              ) : (
                <span className="text-destructive">
                  Rejected by operator{approval.reason ? ` — “${approval.reason}”` : ""}.
                </span>
              )}
            </p>
          ) : rejecting ? (
            <div className="mt-3 space-y-2">
              <label htmlFor={`reason-${approval.id}`} className="block text-xs font-medium text-muted-foreground">
                Reason for rejection (required)
              </label>
              <input
                id={`reason-${approval.id}`}
                value={reason}
                autoFocus
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Output scope is wrong for this task"
                className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!reason.trim()}
                  onClick={() => onReject(approval.id, reason.trim())}
                  className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Confirm rejection
                </button>
                <button
                  type="button"
                  onClick={() => setRejecting(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onApprove(approval.id)}
                className="inline-flex items-center gap-1.5 rounded-md bg-ok px-3 py-1.5 text-xs font-semibold text-ok-foreground transition-opacity hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Approve
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/60 px-3 py-1.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
