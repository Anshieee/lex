import { useEffect, useRef } from "react";
import { AlertOctagon, Paperclip, Terminal } from "lucide-react";
import type { ThreadItem } from "@/lib/agent/types";
import { TraceStepView } from "./TraceStepView";
import { ApprovalCard } from "./ApprovalCard";
import { DeliverableCard } from "./DeliverableCard";

export function ChatThread({
  thread,
  onApprove,
  onReject,
}: {
  thread: ThreadItem[];
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread]);

  if (thread.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
            <Terminal className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
          </div>
          <h2 className="mt-3 text-sm font-semibold">System idle</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Submit a task below. Routing, decomposition, approvals and deliverables will appear here in order, and the
            network monitor stays visible throughout.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="thin-scroll flex-1 space-y-3 overflow-y-auto p-4">
      {thread.map((item) => {
        switch (item.type) {
          case "user":
            return (
              <div key={item.id} className="flex justify-end">
                <div className="max-w-[75%] rounded-md border border-primary/35 bg-primary/10 px-3 py-2">
                  <p className="text-xs uppercase tracking-wider text-primary">Operator</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
                  {item.attachments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {item.attachments.map((a, i) => (
                        <li key={`${a}-${i}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Paperclip className="h-3 w-3" aria-hidden="true" />
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          case "agent":
            return (
              <div key={item.id} className="panel max-w-[85%] px-3 py-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Agent system</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.text}</p>
              </div>
            );
          case "trace":
            return (
              <ul key={item.id} className="ml-0 space-y-1.5">
                {item.steps.map((s) => (
                  <TraceStepView key={s.id} step={s} />
                ))}
              </ul>
            );
          case "approval":
            return <ApprovalCard key={item.id} approval={item.approval} onApprove={onApprove} onReject={onReject} />;
          case "deliverable":
            return <DeliverableCard key={item.id} deliverable={item.deliverable} />;
          case "failure":
            return (
              <div key={item.id} className="panel-raised flex items-start gap-2.5 border-destructive/45 p-3">
                <AlertOctagon className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-destructive">Task failed</p>
                  <p className="mt-1 text-xs leading-relaxed text-foreground">{item.text}</p>
                </div>
              </div>
            );
        }
      })}
      <div ref={endRef} />
    </div>
  );
}
