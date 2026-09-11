import { Boxes, Cpu, LogOut, Menu, PanelLeft } from "lucide-react";
import { NetworkMonitor } from "./NetworkMonitor";
import type { NetworkEvent, TaskState } from "@/lib/agent/types";

const stateLabel: Record<TaskState, { text: string; cls: string }> = {
  idle: { text: "IDLE", cls: "text-muted-foreground" },
  running: { text: "RUNNING", cls: "text-ok" },
  approval_required: { text: "AWAITING APPROVAL", cls: "text-warn" },
  failed: { text: "FAILED", cls: "text-destructive" },
  completed: { text: "COMPLETED", cls: "text-ok" },
};

interface UserInfo {
  username: string;
  role: string;
  display_name: string;
}

function getUser(): UserInfo | null {
  try {
    const raw = localStorage.getItem("lex_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function handleLogout() {
  localStorage.removeItem("lex_token");
  localStorage.removeItem("lex_user");
  window.location.href = "/login";
}

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
  const user = getUser();

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
        {/* User badge */}
        {user && (
          <div className="hidden items-center gap-2 rounded-md border border-border bg-panel-raised px-2.5 py-1.5 text-xs text-secondary-foreground sm:flex">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-bold text-primary-foreground">
              {user.display_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </span>
            <span className="max-w-24 truncate font-medium">{user.display_name}</span>
            <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
              user.role === "admin" ? "bg-primary/15 text-primary" : "bg-ok/15 text-ok"
            }`}>
              {user.role}
            </span>
          </div>
        )}

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
        {/* Logout */}
        <button
          type="button"
          aria-label="Sign out"
          onClick={handleLogout}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
