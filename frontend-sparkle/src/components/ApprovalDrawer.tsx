import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import type { ApprovalRequest } from '@/lib/types';

interface Props {
  approval: ApprovalRequest;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}

export default function ApprovalDrawer({ approval, onApprove, onReject }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [reason, setReason] = useState('');
  const [isRejecting, setIsRejecting] = useState(false);
  const decided = Boolean(approval.decision);

  return (
    <div className={`panel-raised border-l-4 ${
      approval.decision === 'approved' ? 'border-ok' :
      approval.decision === 'rejected' ? 'border-destructive' : 'border-warn'
    }`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            approval.decision === 'approved' ? 'bg-ok/15' :
            approval.decision === 'rejected' ? 'bg-destructive/15' : 'bg-warn/15'
          }`}>
            {approval.decision === 'approved' ? (
              <svg className="w-4 h-4 text-ok" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : approval.decision === 'rejected' ? (
              <svg className="w-4 h-4 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-warn" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
          </div>
          <div>
            <p className="text-sm font-medium">
              {approval.decision === 'approved' ? 'Approved' :
               approval.decision === 'rejected' ? 'Rejected' : 'Approval required'}
            </p>
            <p className="text-xs text-muted-foreground truncate max-w-xs">{approval.action}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">{approval.id}</span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-border p-4 space-y-3">
          <p className="text-sm text-muted-foreground">{approval.detail}</p>

          {decided ? (
            <div className={`rounded-md p-3 text-sm ${
              approval.decision === 'approved'
                ? 'bg-ok/10 text-ok'
                : 'bg-destructive/10 text-destructive'
            }`}>
              {approval.decision === 'approved' ? (
                'Approved by operator — execution resumed.'
              ) : (
                <>
                  Rejected by operator
                  {approval.reason && ` — "${approval.reason}"`}
                  .
                </>
              )}
            </div>
          ) : isRejecting ? (
            <div className="space-y-2">
              <label htmlFor="reject-reason" className="block text-xs font-medium text-muted-foreground">
                Reason for rejection (required)
              </label>
              <input
                id="reject-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Output scope is wrong for this task"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { onReject(approval.id, reason); setIsRejecting(false); setReason(''); }}
                  disabled={!reason.trim()}
                  className="px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50"
                >
                  Confirm rejection
                </button>
                <button
                  onClick={() => setIsRejecting(false)}
                  className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => onApprove(approval.id)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-ok text-ok-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Approve
              </button>
              <button
                onClick={() => setIsRejecting(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
