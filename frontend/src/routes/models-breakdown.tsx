import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Database, Cpu, MemoryStick, CheckCircle, AlertCircle, Filter, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { PromptCompressionModal } from "@/components/dashboard/PromptCompressionModal";

const API_BASE = "http://127.0.0.1:8000";

interface ModelEntry {
  id: string;
  name: string;
  role: string;
  task_types: string[];
  state: "loaded" | "idle" | "unavailable";
  intelligence: number;
  reliability: number;
  speed: number;
  resident: boolean;
  vram_usage_mb: number;
}

interface ModelStats {
  requests: number;
  success_rate: number;
  avg_latency_ms: number;
  task_types: Record<string, number>;
}

export const Route = createFileRoute("/models-breakdown")({
  head: () => ({
    meta: [
      { title: "LEX — Models Breakdown" },
      { name: "description", content: "Per-model usage breakdown with residency status and VRAM utilization." },
    ],
  }),
  component: ModelsBreakdownPage,
});

function ModelsBreakdownPage() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelStats, setModelStats] = useState<Record<string, ModelStats>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCompression, setShowCompression] = useState(false);
  const [compressionConfig, setCompressionConfig] = useState({
    mode: "Off" as const,
    repeated_blocks: false,
    whitespace_cleanup: false,
    json_tables: false,
    superseded_file_reads: false,
    tool_output_filter: false,
    relevance_filter: false,
    older_turns: false,
    token_ceiling: false,
  });

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("lex_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch model registry
      const modelsRes = await fetch(`${API_BASE}/api/models`);
      if (modelsRes.ok) {
        const modelsData = await modelsRes.json();
        setModels(modelsData.models);
      }

      // Try to fetch per-model stats
      try {
        const statsRes = await fetch(`${API_BASE}/api/models/stats`, {
          headers: getAuthHeaders(),
        });
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setModelStats(statsData.models || {});
        }
      } catch {
        // Stats endpoint not available yet - will use empty stats
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Background */}
      <div className="galaxy-nebula pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />
      <div className="galaxy-vignette pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />

      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted">
                <Database className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Models Breakdown</h1>
                <p className="text-xs text-muted-foreground">Per-model usage with residency status and VRAM utilization</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchModels}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
            >
              <Loader2 className={cn("h-4 w-4", loading && "spin-slow")} aria-hidden="true" />
              Refresh
            </button>
            <button
              onClick={() => setShowCompression(true)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="panel p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Models</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">{models.length}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Loaded</p>
            <p className="mt-1 text-2xl font-semibold text-ok">{models.filter((m) => m.state === "loaded").length}</p>
          </div>
          <div className="panel p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total VRAM</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {formatNumber(models.reduce((acc, m) => acc + (m.resident ? m.vram_usage_mb : 0), 0))} MB
            </p>
          </div>
          <div className="panel p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Requests</p>
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {models.reduce((acc, m) => acc + (modelStats[m.id]?.requests ?? 0), 0)}
            </p>
          </div>
        </div>

        {/* Model Table */}
        <section className="panel" aria-labelledby="models-heading">
          <h2 id="models-heading" className="sr-only">Model Breakdown</h2>

          {loading && models.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="spin-slow h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-2">Model</th>
                    <th className="text-left p-2 hidden md:table-cell">Role</th>
                    <th className="text-left p-2 hidden lg:table-cell">Task Types</th>
                    <th className="text-left p-2">Resident</th>
                    <th className="text-left p-2 hidden sm:table-cell">VRAM</th>
                    <th className="text-left p-2 hidden lg:table-cell">Requests</th>
                    <th className="text-left p-2">Success Rate</th>
                    <th className="text-left p-2 hidden lg:table-cell">Avg Latency</th>
                    <th className="text-left p-2 hidden xl:table-cell">Task Types</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {models.map((model) => {
                    const stats = modelStats[model.name] || {
                      requests: 0,
                      success_rate: 0,
                      avg_latency_ms: 0,
                      task_types: {},
                    };

                    return (
                      <tr key={model.id} className="hover:bg-accent/30 transition-colors">
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "h-2 w-2 rounded-full",
                                model.state === "loaded" && "bg-ok",
                                model.state === "idle" && "bg-muted-foreground",
                                model.state === "unavailable" && "bg-destructive"
                              )}
                              aria-label={`Status: ${model.state}`}
                            />
                            <div>
                              <p className="font-mono text-[11px] text-foreground">{model.name}</p>
                              <p className="text-[10px] text-muted-foreground md:hidden">{model.role}</p>
                            </div>
                          </div>
                        </td>
                        <td className="p-2 text-[11px] text-muted-foreground hidden md:table-cell max-w-48 truncate">{model.role}</td>
                        <td className="p-2 hidden lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {model.task_types.map((tt) => (
                              <span key={tt} className="rounded px-1.5 py-0.5 font-mono text-[9px] bg-muted text-muted-foreground">
                                {tt}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-2">
                          {model.resident ? (
                            <CheckCircle className="h-4 w-4 text-ok" aria-label="Resident model" />
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-muted-foreground hidden sm:table-cell">
                          {model.vram_usage_mb > 0 ? `${model.vram_usage_mb} MB` : "CPU"}
                        </td>
                        <td className="p-2 font-mono text-[11px] text-foreground hidden lg:table-cell">{stats.requests}</td>
                        <td className="p-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px]",
                              stats.success_rate >= 95 && "bg-ok/15 text-ok",
                              stats.success_rate >= 80 ? "bg-warn/15 text-warn" :
                              stats.success_rate > 0 ? "bg-destructive/15 text-destructive" :
                              "bg-muted text-muted-foreground"
                            )}
                          >
                            {stats.requests > 0 ? `${stats.success_rate.toFixed(0)}%` : "—"}
                          </span>
                        </td>
                        <td className="p-2 font-mono text-[11px] text-muted-foreground hidden lg:table-cell">
                          {stats.requests > 0 ? formatDuration(stats.avg_latency_ms) : "—"}
                        </td>
                        <td className="p-2 hidden xl:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(stats.task_types).map(([tt, count]) => (
                              <span key={tt} className="rounded px-1.5 py-0.5 font-mono text-[9px] bg-muted text-muted-foreground">
                                {tt} ({count})
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Missing Stats Note */}
        {!loading && Object.keys(modelStats).length === 0 && models.length > 0 && (
          <div className="mt-4 panel p-4 bg-warn/5 border-warn/20">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-warn shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-warn">Per-Model Stats Endpoint Missing</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The <code className="font-mono bg-muted px-1 rounded">/api/models/stats</code> endpoint is not yet implemented.
                  Usage statistics (requests, success rate, latency, tokens) will appear once the backend endpoint is added.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <PromptCompressionModal
        open={showCompression}
        onClose={() => setShowCompression(false)}
        config={compressionConfig}
        onSave={setCompressionConfig}
      />
    </div>
  );
}