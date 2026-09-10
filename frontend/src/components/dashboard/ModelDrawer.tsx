import { X } from "lucide-react";
import type { ActiveModel } from "@/lib/agent/types";
import { ActiveModels, KnowledgeBase } from "./SidePanels";
import { cn } from "@/lib/utils";

export function ModelDrawer({
  open,
  onClose,
  models,
  busy,
  docCount,
  onIngest,
  children,
}: {
  open: boolean;
  onClose: () => void;
  models: ActiveModel[];
  busy: boolean;
  docCount: number;
  onIngest: (name: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close models drawer"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm"
        />
      )}
      <aside
        aria-label="Active models"
        aria-hidden={!open}
        className={cn(
          "panel fixed inset-y-3 right-3 z-40 flex w-[min(21rem,calc(100vw-1.5rem))] flex-col transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none translate-x-[calc(100%+1rem)]",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
          <span className="text-sm font-semibold tracking-tight">Active models</span>
          <button
            type="button"
            aria-label="Close models drawer"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3 pt-0">
          <ActiveModels models={models} busy={busy} />
          <KnowledgeBase docCount={docCount} onIngest={onIngest} />
          {children}
        </div>
      </aside>
    </>
  );
}
