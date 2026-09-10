import { Database, Upload } from "lucide-react";
import type { ActiveModel } from "@/lib/agent/types";

export function ActiveModels({ models, busy }: { models: ActiveModel[]; busy: boolean }) {
  return (
    <section className="panel p-3" aria-label="Active models">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active models</h2>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{models.length}</span>
      </div>
      <ul className="space-y-1.5">
        {models.map((m) => {
          const loaded = m.state === "loaded";
          return (
            <li
              key={m.id}
              className="flex items-center gap-2.5 rounded-md border border-border bg-background/50 px-2.5 py-2"
            >
              <span
                className={`status-dot ${loaded ? "status-dot--ok" : "status-dot--idle"} ${busy && loaded ? "status-dot--pulse" : ""}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[11.5px] text-foreground">{m.name}</p>
                <p className="truncate text-[10.5px] text-muted-foreground">{m.role}</p>
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase ${
                  loaded ? "bg-ok/15 text-ok" : "bg-muted text-muted-foreground"
                }`}
              >
                {loaded ? "loaded" : "on-demand"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function KnowledgeBase({ docCount, onIngest }: { docCount: number; onIngest: (name: string) => void }) {
  return (
    <section className="panel p-3" aria-label="Knowledge base">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Knowledge base</h2>
        <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="rounded-md border border-border bg-background/50 px-2.5 py-3">
        <p className="font-mono text-2xl text-foreground">{docCount}</p>
        <p className="text-[10.5px] text-muted-foreground">documents indexed locally</p>
      </div>
      <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent">
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        Add PDF / DOCX / image
        <input
          type="file"
          className="sr-only"
          accept=".pdf,.docx,.jpg,.jpeg,.png"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onIngest(f.name);
            e.target.value = "";
          }}
        />
      </label>
    </section>
  );
}
