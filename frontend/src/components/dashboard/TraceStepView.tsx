import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  FileSearch,
  GitBranch,
  Loader2,
  Package,
  PenLine,
  Route,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { TraceStep } from "@/lib/agent/types";

const kindIcon: Record<TraceStep["kind"], typeof Route> = {
  route: Route,
  decompose: GitBranch,
  retrieve: FileSearch,
  generate: PenLine,
  verify: ShieldCheck,
  package: Package,
};

function StatusIcon({ status }: { status: TraceStep["status"] }) {
  switch (status) {
    case "pending":
      return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" aria-label="pending" />;
    case "running":
      return <Loader2 className="spin-slow h-3.5 w-3.5 text-ok" aria-label="running" />;
    case "done":
      return <CheckCircle2 className="h-3.5 w-3.5 text-ok" aria-label="done" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" aria-label="failed" />;
  }
}

function ModeBadge({ mode }: { mode?: string }) {
  if (!mode) return null;
  const isGVisor = mode.toLowerCase().includes("gvisor");
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-mono shrink-0 ${
        isGVisor
          ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
          : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
      }`}
      title={mode}
    >
      {isGVisor ? "gVisor" : "Local"}
    </span>
  );
}

export function TraceStepView({ step }: { step: TraceStep }) {
  const [open, setOpen] = useState(false);
  const Icon = kindIcon[step.kind];
  const hasRaw = step.status === "done" || step.status === "failed";

  return (
    <li className="rounded-md border border-border bg-background/50">
      <button
        type="button"
        disabled={!hasRaw}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={hasRaw ? open : undefined}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left disabled:cursor-default"
      >
        <StatusIcon status={step.status} />
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{step.label}</span>
        {step.model && <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground md:inline">{step.model}</span>}
        <ModeBadge mode={step.mode} />
        {hasRaw &&
          (open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ))}
      </button>
      {open && hasRaw && (
        <pre className="thin-scroll mx-2.5 mb-2 max-h-48 overflow-auto rounded border border-border bg-background p-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {step.raw ?? "(no raw output captured)"}
        </pre>
      )}
    </li>
  );
}
