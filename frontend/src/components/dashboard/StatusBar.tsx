import { Activity, Clock, Cpu, Zap } from "lucide-react";
import type { GenerationMetrics } from "@/lib/agent/types";

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `00:${String(sec).padStart(2, "0")}s`;
}

function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function StatusBar({ metrics }: { metrics: GenerationMetrics }) {
  if (!metrics.isRunning && metrics.elapsedMs === 0) return null;

  const isActive = metrics.isRunning;

  return (
    <div
      className={`status-bar mx-1 mb-1.5 flex items-center gap-0 rounded-lg border px-1 py-1.5 transition-all duration-500 ${
        isActive
          ? "status-bar--active border-primary/30"
          : "border-border/50 opacity-80"
      }`}
      role="status"
      aria-label="Generation status"
      aria-live="polite"
    >
      {/* Elapsed Time */}
      <div className="flex items-center gap-1.5 border-r border-border/40 px-3">
        <Clock
          className={`h-3.5 w-3.5 ${isActive ? "text-primary" : "text-muted-foreground"}`}
          aria-hidden="true"
        />
        <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
          {formatElapsed(metrics.elapsedMs)}
        </span>
      </div>

      {/* Current Step */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 border-r border-border/40 px-3">
        {isActive ? (
          <span className="status-dot status-dot--ok status-dot--pulse" aria-hidden="true" />
        ) : (
          <Activity className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate text-xs text-foreground">
          {metrics.currentStep || "Idle"}
        </span>
      </div>

      {/* Tokens/sec */}
      {metrics.tokensPerSecond > 0 && (
        <div className="flex items-center gap-1.5 border-r border-border/40 px-3">
          <Zap
            className={`h-3.5 w-3.5 ${isActive ? "text-warn" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
          <span className="font-mono text-xs tabular-nums text-foreground">
            {metrics.tokensPerSecond.toFixed(1)}
            <span className="text-muted-foreground"> tok/s</span>
          </span>
        </div>
      )}

      {/* Total Tokens */}
      {(metrics.totalTokensIn > 0 || metrics.totalTokensOut > 0) && (
        <div className="flex items-center gap-1.5 px-3">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatTokens(metrics.totalTokensIn + metrics.totalTokensOut)}
            <span className="hidden sm:inline"> tokens</span>
          </span>
        </div>
      )}
    </div>
  );
}
