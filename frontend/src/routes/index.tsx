import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { RotateCcw, Play, AlertTriangle, Zap } from "lucide-react";
import { useAgentStore } from "@/lib/agent/useAgentStore";
import { GalaxyBackground } from "@/components/dashboard/GalaxyBackground";
import { GalaxyBrain } from "@/components/dashboard/GalaxyBrain";
import { Header } from "@/components/dashboard/Header";
import { ChatThread } from "@/components/dashboard/ChatThread";
import { StatusBar } from "@/components/dashboard/StatusBar";
import { Composer } from "@/components/dashboard/Composer";
import { NavSidebar } from "@/components/dashboard/NavSidebar";
import { ModelDrawer } from "@/components/dashboard/ModelDrawer";

const DEV_CONTROLS = import.meta.env.DEV;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LEX — Living Multi-Model Agent Workspace" },
      {
        name: "description",
        content:
          "LEX is a local multi-model AI agent workspace: living galaxy core, live routing trace, blocking approvals, network isolation monitor and generated deliverables.",
      },
      { property: "og:title", content: "LEX — Living Multi-Model Agent Workspace" },
      {
        property: "og:description",
        content:
          "Live agent trace, blocking approval checkpoints, zero-external-connection network monitor and downloadable deliverables.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Console,
});

function Console() {
  const store = useAgentStore();
  const busy = store.state === "running" || store.state === "approval_required";
  const [navOpen, setNavOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const hasChat = store.thread.length > 0;

  // Escape closes any open drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setNavOpen(false);
        setModelsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Touch: left-edge swipe opens nav, swipe back closes it
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) touch.current = { x: t.clientX, y: t.clientY };
    };
    const end = (e: TouchEvent) => {
      const s = touch.current;
      const t = e.changedTouches[0];
      touch.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = Math.abs(t.clientY - s.y);
      if (dy > 60) return;
      if (dx > 60 && s.x < 32) setNavOpen(true);
      else if (dx < -60) setNavOpen(false);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
    };
  }, []);

  return (
    <>
      <GalaxyBackground activity={store.state} />
      <div className="flex h-screen p-3">
        <NavSidebar
          open={navOpen}
          onClose={() => setNavOpen(false)}
          onNewChat={store.reset}
        />

        <main className="flex min-w-0 flex-1 flex-col gap-3">
          <Header
            network={store.network}
            outboundCount={store.outboundCount}
            modelCount={store.models.length}
            state={store.state}
            onMenu={() => setNavOpen((v) => !v)}
            onModels={() => setModelsOpen((v) => !v)}
            modelsOpen={modelsOpen}
          />

          <section className="panel relative flex min-h-0 flex-1 flex-col" aria-label="Task workspace">
            {hasChat ? (
              <>
                <div
                  className="pointer-events-none absolute inset-x-0 top-1/2 z-0 mx-auto h-56 w-56 -translate-y-1/2 opacity-25 transition-all duration-700"
                  aria-hidden="true"
                >
                  <GalaxyBrain state={store.state} compact />
                </div>
                <div className="relative z-10 flex min-h-0 flex-1 flex-col">
                  <ChatThread thread={store.thread} onApprove={store.approve} onReject={store.reject} />
                </div>
              </>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
                <div className="h-[min(46vh,22rem)] w-[min(46vh,22rem)] transition-all duration-700">
                  <GalaxyBrain state={store.state} compact={false} />
                </div>
                <h2 className="-mt-6 text-lg font-semibold tracking-tight">LEX is listening</h2>
                <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Submit a task below. Routing, decomposition, approvals and deliverables appear here in order — all
                  processed locally, with the network monitor visible at all times.
                </p>
              </div>
            )}

            <div className="shrink-0 border-t border-border">
              <StatusBar metrics={store.metrics} />
              <div className="p-3 pt-1.5">
                <Composer
                  disabled={busy}
                  onSend={(text, attachments, files) => store.sendTask(text, attachments, files)}
                  models={store.models}
                  selectedModel={store.selectedModel}
                  onSelectModel={store.setSelectedModel}
                />
              </div>
            </div>
          </section>
        </main>

        <ModelDrawer
          open={modelsOpen}
          onClose={() => setModelsOpen(false)}
          models={store.models}
          busy={store.state === "running"}
          docCount={store.kbDocCount}
          onIngest={() => store.ingestDocument()}
        >
          {DEV_CONTROLS && (
            <section className="panel p-3" aria-label="Demo controls">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Demo controls (dev only)
              </h2>
              <div className="grid grid-cols-2 gap-1.5">
                <DemoButton
                  icon={Play}
                  label="Simulate task"
                  disabled={busy}
                  onClick={() => store.sendTask("Draft a compliance summary from the indexed documents.", [])}
                />
                <DemoButton
                  icon={Zap}
                  label="No approval"
                  disabled={busy}
                  onClick={() => store.sendTask("Summarise the latest indexed report.", [])}
                />
                <DemoButton
                  icon={AlertTriangle}
                  label="Simulate failure"
                  disabled={busy}
                  onClick={() => store.sendTask("Process the full archive corpus.", [])}
                />
                <DemoButton icon={RotateCcw} label="Reset demo" disabled={false} onClick={store.reset} />
              </div>
            </section>
          )}
        </ModelDrawer>
      </div>
    </>
  );
}

function DemoButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Play;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2 py-1.5 text-[11px] text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-40"
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </button>
  );
}
