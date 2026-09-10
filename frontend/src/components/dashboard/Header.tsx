import { Boxes, Cpu, Menu, PanelLeft } from "lucide-react";
import { NetworkMonitor } from "./NetworkMonitor";
import type { NetworkEvent, TaskState } from "@/lib/agent/types";

const stateLabel: Record<TaskState, { text: string; cls: string }> = {
  idle: { text: "IDLE", cls: "text-muted-foreground" },
  running: { text: "RUNNING", cls: "text-ok" },
  approval_required: { text: "AWAITING APPROVAL", cls: "text-warn" },
  failed: { text: "FAILED", cls: "text-destructive" },
  completed: { text: "COMPLETED", cls: "text-ok" },
};

export function Header({
  network,
  outboundCount,
  modelCount,
  state,
  onMenu,
  onModels,
  modelsOpen,
}: {
  network: NetworkEvent[];
  outboundCount: number;
  modelCount: number;
  state: TaskState;
  onMenu: () => void;
  onModels: () => void;
  modelsOpen: boolean;
}) {
  const s = stateLabel[state];
  return (
    <header className="panel flex h-14 shrink-0 items-center justify-between gap-3 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={onMenu}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted">
          <Boxes className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">LEX</h1>
          <p className={`font-mono text-[10px] uppercase tracking-widest ${s.cls}`}>{s.text}</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-xs text-secondary-foreground sm:flex">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono">{modelCount} models</span>
        </div>
        <NetworkMonitor events={network} outboundCount={outboundCount} />
        <button
          type="button"
          aria-label="Open active models"
          aria-expanded={modelsOpen}
          onClick={onModels}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Menu className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
