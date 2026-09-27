import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, BarChart3, TrendingUp, Clock, CheckCircle, XCircle, Database, Cpu, Zap, Shield, Brain, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { PromptCompressionModal } from "@/components/dashboard/PromptCompressionModal";

const API_BASE = "http://127.0.0.1:8000";

interface AnalyticsData {
  summary: {
    total_requests: number;
    success_rate: number;
    avg_latency_ms: number;
  };
  by_model: Record<string, {
    requests: number;
    success_rate: number;
    avg_latency_ms: number;
    task_types: Record<string, number>;
  }>;
  by_task_type: Record<string, {
    requests: number;
    success_rate: number;
    avg_latency_ms: number;
  }>;
  time_series: Array<{
    hour: string;
    requests: number;
    success_rate: number;
    avg_latency_ms: number;
  }>;
}

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "LEX — Local Analytics" },
      { name: "description", content: "Local inference metrics: latency, success rates, tool-specific stats." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
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

  const fetchAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analytics`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Admin access required");
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const result: AnalyticsData = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const formatNumber = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const statCards = [
    { label: "Total Requests", value: data?.summary.total_requests ?? "—", icon: Database, color: "text-primary" },
    { label: "Success Rate", value: data ? `${data.summary.success_rate.toFixed(1)}%` : "—", icon: CheckCircle, color: "text-ok" },
    { label: "Avg Latency", value: data ? formatDuration(data.summary.avg_latency_ms) : "—", icon: Clock, color: "text-yellow-400" },
    { label: "Total Tasks", value: data ? Object.entries(data.by_task_type).reduce((acc, [, v]) => acc + v.requests, 0) : "—", icon: BarChart3, color: "text-green-400" },
  ];

  // Tool-specific success rates (sandbox, OCR, RAG)
  const toolStats = [
    { name: "RAG Retrieval", key: "execute_rag_retrieval", icon: Database, color: "text-blue-400" },
    { name: "Vision OCR", key: "execute_vision_ocr", icon: Zap, color: "text-yellow-400" },
    { name: "Code Execution", key: "execute_code_execution", icon: Shield, color: "text-green-400" },
    { name: "General Reasoning", key: "execute_general_reasoning", icon: Brain, color: "text-cyan-400" },
    { name: "Planner", key: "planner", icon: Cpu, color: "text-primary" },
  ];

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
                <BarChart3 className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Local Analytics</h1>
                <p className="text-xs text-muted-foreground">Local inference metrics — latency, success rates, tool-specific stats</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCompression(true)} className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">
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

        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {statCards.map((stat) => (
            <div key={stat.label} className="panel p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-foreground">{stat.value}</p>
                </div>
                <stat.icon className={cn("h-5 w-5", stat.color)} aria-hidden="true" />
              </div>
            </div>
          ))}
        </div>

        {/* Tool-Specific Success Rates */}
        <section className="panel mb-6" aria-labelledby="tools-heading">
          <h2 id="tools-heading" className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Tool-Specific Success Rates
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="spin-slow h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {toolStats.map(({ name, key, icon: Icon, color }) => {
                const stats = data?.by_task_type[key];
                return (
                  <div key={key} className="panel p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={cn("h-4 w-4", color)} aria-hidden="true" />
                      <span className="text-xs font-medium text-foreground">{name}</span>
                    </div>
                    {stats ? (
                      <>
                        <p className="text-lg font-semibold text-foreground">{stats.requests}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className={cn("font-medium", stats.success_rate >= 95 ? "text-ok" : stats.success_rate >= 80 ? "text-warn" : "text-destructive")}>
                            {stats.success_rate.toFixed(1)}%
                          </span>
                          {" "}success rate
                        </p>
                        <p className="text-xs text-muted-foreground">Avg: {formatDuration(stats.avg_latency_ms)}</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">No data</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* By Model */}
        <section className="panel mb-6" aria-labelledby="by-model-heading">
          <h2 id="by-model-heading" className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            By Model
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="spin-slow h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-2">Model</th>
                    <th className="text-left p-2">Requests</th>
                    <th className="text-left p-2">Success Rate</th>
                    <th className="text-left p-2">Avg Latency</th>
                    <th className="text-left p-2 hidden md:table-cell">Task Types</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {Object.entries(data?.by_model || {}).map(([model, stats]) => (
                    <tr key={model} className="hover:bg-accent/30 transition-colors">
                      <td className="p-2 font-mono text-[11px] text-foreground">{model || "(system)"}</td>
                      <td className="p-2 font-mono text-[11px] text-foreground">{stats.requests}</td>
                      <td className="p-2">
                        <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px]",
                          stats.success_rate >= 95 ? "bg-ok/15 text-ok" :
                          stats.success_rate >= 80 ? "bg-warn/15 text-warn" : "bg-destructive/15 text-destructive"
                        )}>
                          {stats.success_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-2 font-mono text-[11px] text-muted-foreground">{formatDuration(stats.avg_latency_ms)}</td>
                      <td className="p-2 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(stats.task_types).map(([tt, count]) => (
                            <span key={tt} className="rounded px-1.5 py-0.5 font-mono text-[9px] bg-muted text-muted-foreground">
                              {tt} ({count})
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Time Series */}
        <section className="panel" aria-labelledby="timeseries-heading">
          <h2 id="timeseries-heading" className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Requests Over Time
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="spin-slow h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
          ) : data?.time_series && data.time_series.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-2">Hour</th>
                    <th className="text-left p-2">Requests</th>
                    <th className="text-left p-2">Success Rate</th>
                    <th className="text-left p-2">Avg Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.time_series.map((point) => (
                    <tr key={point.hour} className="hover:bg-accent/30 transition-colors">
                      <td className="p-2 font-mono text-[11px] text-muted-foreground">{new Date(point.hour).toLocaleString()}</td>
                      <td className="p-2 font-mono text-[11px] text-foreground">{point.requests}</td>
                      <td className="p-2">
                        <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[9px]",
                          point.success_rate >= 95 ? "bg-ok/15 text-ok" :
                          point.success_rate >= 80 ? "bg-warn/15 text-warn" : "bg-destructive/15 text-destructive"
                        )}>
                          {point.success_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-2 font-mono text-[11px] text-muted-foreground">{formatDuration(point.avg_latency_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <BarChart3 className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
              <p className="text-sm">No time-series data available</p>
              <p className="text-[11px]">Submit tasks to generate analytics</p>
            </div>
          )}
        </section>
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