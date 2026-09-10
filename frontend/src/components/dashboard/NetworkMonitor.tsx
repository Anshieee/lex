import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldCheck } from "lucide-react";
import type { NetworkEvent } from "@/lib/agent/types";

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-GB", { hour12: false }) +
  "." +
  String(new Date(ts).getMilliseconds()).padStart(3, "0");

export function NetworkMonitor({ events, outboundCount }: { events: NetworkEvent[]; outboundCount: number }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
      >
        <span className={`status-dot ${outboundCount === 0 ? "status-dot--ok" : "status-dot--warn"}`} />
        <ShieldCheck className="h-3.5 w-3.5 text-ok" aria-hidden="true" />
        <span className="font-mono">{outboundCount} outbound</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>

      {open && (
        <div className="panel-raised absolute right-0 top-full z-50 mt-2 w-[26rem] max-w-[85vw] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Network event log</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {events.length} events
            </span>
          </div>
          <ul className="thin-scroll max-h-64 space-y-1 overflow-y-auto font-mono text-[11px]">
            {[...events].reverse().map((e) => (
              <li key={e.id} className="rounded border border-border bg-background/60 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{fmtTime(e.timestamp)}</span>
                  <span className={e.kind === "outbound" ? "text-warn" : "text-ok"}>{e.destination}</span>
                </div>
                <div className="mt-0.5 text-muted-foreground">{e.detail}</div>
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t border-border pt-2 text-[10px] text-muted-foreground">
            All traffic is loopback (127.0.0.1). Zero external connections.
          </p>
        </div>
      )}
    </div>
  );
}
