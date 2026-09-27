import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Search, Filter, ChevronDown, ChevronUp, Download, X, CheckCircle, AlertCircle, XCircle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import { PromptCompressionModal } from "@/components/dashboard/PromptCompressionModal";

const API_BASE = "http://127.0.0.1:8000";

interface AuditLogEntry {
  timestamp: string;
  task_id: string;
  step_type: string;
  model_used: string;
  duration_ms: number;
  input_summary: string;
  output_summary: string;
  status: string;
  user: string;
  extra?: Record<string, any>;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
}

const STATUS_CONFIG = {
  success: { label: "Success", icon: CheckCircle, color: "text-ok", bg: "bg-ok/15" },
  failed: { label: "Failed", icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/15" },
  error: { label: "Error", icon: AlertCircle, color: "text-destructive", bg: "bg-destructive/15" },
  canceled: { label: "Canceled", icon: Ban, color: "text-warn", bg: "bg-warn/15" },
};

const STEP_TYPE_LABELS: Record<string, string> = {
  task_submitted: "Task Submitted",
  planner: "Planner",
  execute_rag_retrieval: "RAG Retrieval",
  execute_vision_ocr: "Vision OCR",
  execute_code_execution: "Code Execution",
  execute_general_reasoning: "General Reasoning",
  approval: "Approval",
  synthesize_deliverable: "Synthesize Deliverable",
  task_error: "Task Error",
  login: "Login",
  user_preferences: "User Preferences",
  file_upload: "File Upload",
  ingest: "RAG Ingest",
  ingest_directory: "RAG Ingest Directory",
  ingest_error: "RAG Ingest Error",
  approval_error: "Approval Error",
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Errors" },
  { value: "canceled", label: "Canceled" },
] as const;

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "LEX — Audit Logs" },
      { name: "description", content: "View recent agent invocations, execution status, and token usage." },
    ],
  }),
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<typeof FILTER_OPTIONS[0]["value"]>("all");
  const [search, setSearch] = useState("");
  const [showDownload, setShowDownload] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
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

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/audit/log?n=200`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Admin access required");
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data: AuditLogResponse = await res.json();
      setEntries(data.entries);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    setDownloadLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/audit/log/download`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit_log.jsonl";
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDownloadLoading(false);
      setShowDownload(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredEntries = entries.filter((entry) => {
    if (filter !== "all" && entry.status !== filter) return false;
    if (search) {
      const searchLower = search.toLowerCase();
      const match =
        entry.task_id.toLowerCase().includes(searchLower) ||
        entry.step_type.toLowerCase().includes(searchLower) ||
        entry.model_used.toLowerCase().includes(searchLower) ||
        entry.input_summary.toLowerCase().includes(searchLower) ||
        entry.user.toLowerCase().includes(searchLower);
      if (!match) return false;
    }
    return true;
  });

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      month: "short",
      day: "numeric",
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

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
                <Filter className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Audit Logs</h1>
                <p className="text-xs text-muted-foreground">Recent agent invocations, execution status, and token usage</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowDownload(true)}
              disabled={downloadLoading}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {downloadLoading ? "Downloading…" : "Download JSONL"}
            </button>
            <button
              onClick={() => setShowCompression(true)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              <Filter className="h-4 w-4" aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Filter & Search */}
        <div className="panel mb-4 p-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Filter Chips */}
            <div className="flex flex-wrap gap-1.5">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
                    filter === opt.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {opt.value !== "all" && (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        opt.value === "success" && "bg-ok",
                        opt.value === "failed" && "bg-destructive",
                        opt.value === "canceled" && "bg-warn"
                      )}
                      aria-hidden="true"
                    />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search task ID, model, step, user…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <section className="panel" aria-labelledby="audit-heading">
          <h2 id="audit-heading" className="sr-only">Audit Log Entries</h2>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="spin-slow h-6 w-6 text-muted-foreground" aria-hidden="true" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <Filter className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
              <p className="text-sm">No entries found</p>
              <p className="text-[11px]">Try adjusting filters or search</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" role="table">
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Task ID</th>
                    <th className="text-left p-2">Client App</th>
                    <th className="text-left p-2 hidden md:table-cell">Model</th>
                    <th className="text-left p-2">Step Type</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2 hidden lg:table-cell">Duration</th>
                    <th className="text-left p-2 hidden lg:table-cell">In/Out Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredEntries.map((entry) => {
                    const statusConfig = STATUS_CONFIG[entry.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.failed;
                    const StatusIcon = statusConfig.icon;
                    const stepLabel = STEP_TYPE_LABELS[entry.step_type] || entry.step_type;

                    return (
                      <tr key={entry.timestamp + entry.task_id + entry.step_type} className="hover:bg-accent/30 transition-colors">
                        <td className="p-2 font-mono text-[11px] text-muted-foreground">{formatTime(entry.timestamp)}</td>
                        <td className="p-2 font-mono text-[11px] text-foreground max-w-32 truncate">{entry.task_id}</td>
                        <td className="p-2 text-[11px] text-foreground max-w-24 truncate">{entry.user || "system"}</td>
                        <td className="p-2 text-[11px] text-muted-foreground hidden md:table-cell max-w-28 truncate">{entry.model_used || "—"}</td>
                        <td className="p-2 text-[11px] text-foreground">{stepLabel}</td>
                        <td className="p-2">
                          <span className={cn("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[9px]", statusConfig.bg, statusConfig.color)}>
                            <StatusIcon className="h-2.5 w-2.5" aria-hidden="true" />
                            {statusConfig.label}
                          </span>
                        </td>
                        <td className="p-2 font-mono text-[10px] text-muted-foreground hidden lg:table-cell">{formatDuration(entry.duration_ms)}</td>
                        <td className="p-2 font-mono text-[10px] text-muted-foreground hidden lg:table-cell">— / —</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Download Confirmation */}
      {showDownload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="panel w-full max-w-md">
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Download Audit Log</h3>
                <button onClick={() => setShowDownload(false)} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
              </div>
              <p className="text-sm text-muted-foreground">Download the full audit log as a JSONL file. This includes all entries beyond the last 200 shown in the table.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDownload(false)} className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent">Cancel</button>
                <button onClick={handleDownload} disabled={downloadLoading} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40">
                  {downloadLoading ? "Downloading…" : "Download"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (Prompt Compression) */}
      <PromptCompressionModal
        open={showCompression}
        onClose={() => setShowCompression(false)}
        config={compressionConfig}
        onSave={setCompressionConfig}
      />
    </div>
  );
}