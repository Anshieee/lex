import { useState, useEffect } from 'react';
import { Download, Loader2, AlertCircle, Calendar } from 'lucide-react';
import { getMonthlyReport } from '@/lib/api';
import type { MonthlyReportResult } from '@/lib/api';

export default function ReportsView() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [report, setReport] = useState<MonthlyReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const data = await getMonthlyReport(month);
      setReport(data as MonthlyReportResult);
    } catch (err: any) {
      if (err.message === 'Admin access required') {
        setError('Admin access required to view reports');
      } else if (err.message === 'Invalid month format') {
        setError('Invalid month format (expected YYYY-MM)');
      } else {
        setError(err.message || 'Failed to load report');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [month]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await getMonthlyReport(month, 'docx') as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lex-report-${month}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      if (err.message === 'Admin access required') {
        setError('Admin access required to download report');
      } else {
        setError(err.message || 'Failed to download report');
      }
    } finally {
      setDownloading(false);
    }
  };

  const formatNull = (value: number | string | null | undefined): string => {
    if (value === null || value === undefined) return 'Not recorded';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && value < 1) return value.toFixed(2);
    return value.toString();
  };

  const formatRate = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return 'Not recorded';
    return `${(value * 100).toFixed(1)}%`;
  };

  if (!report) {
    return (
      <div className="h-full overflow-y-auto p-6 thin-scroll">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-semibold">Monthly Statistics Report</h1>
              <p className="text-xs text-muted-foreground">Select a month to generate the report</p>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                onClick={loadReport}
                disabled={loading}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 spin-slow" /> : 'Generate'}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 thin-scroll">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">Monthly Statistics Report</h1>
            <p className="text-xs text-muted-foreground">Report for {report.month}</p>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={loadReport}
              disabled={loading}
              className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 spin-slow" /> : 'Generate'}
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {downloading ? 'Downloading...' : 'Download .docx'}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Totals */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-4">Totals</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Tasks</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatNull(report.totals.tasks)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Completed</p>
              <p className="mt-1 text-2xl font-semibold text-ok">{formatNull(report.totals.completed)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Failed</p>
              <p className="mt-1 text-2xl font-semibold text-destructive">{formatNull(report.totals.failed)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Success Rate</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatRate(report.totals.success_rate)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Approvals</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatNull(report.totals.approvals)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Rejections</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatNull(report.totals.rejections)}</p>
            </div>
          </div>
        </section>

        {/* By Model */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-4">By Model</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-2">Model</th>
                  <th className="text-right p-2">Requests</th>
                  <th className="text-right p-2">Success Rate</th>
                  <th className="text-right p-2 hidden lg:table-cell">Avg Latency</th>
                  <th className="text-right p-2 hidden lg:table-cell">Input Tokens</th>
                  <th className="text-right p-2 hidden lg:table-cell">Output Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.by_model.map((m, i) => (
                  <tr key={i} className="hover:bg-accent/30 transition-colors">
                    <td className="p-2 font-mono text-[11px] text-foreground">{m.model || '(system)'}</td>
                    <td className="p-2 text-right font-mono">{formatNull(m.requests)}</td>
                    <td className="p-2 text-right">{formatRate(m.success_rate)}</td>
                    <td className="p-2 text-right font-mono text-muted-foreground hidden lg:table-cell">{formatNull(m.avg_latency_ms)}ms</td>
                    <td className="p-2 text-right font-mono text-muted-foreground hidden lg:table-cell">{formatNull(m.input_tokens)}</td>
                    <td className="p-2 text-right font-mono text-muted-foreground hidden lg:table-cell">{formatNull(m.output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* By Task Type */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-4">By Task Type</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-2">Task Type</th>
                  <th className="text-right p-2">Count</th>
                  <th className="text-right p-2">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.by_task_type.map((t, i) => (
                  <tr key={i} className="hover:bg-accent/30 transition-colors">
                    <td className="p-2 font-mono text-[11px] text-foreground">{t.task_type}</td>
                    <td className="p-2 text-right font-mono">{formatNull(t.count)}</td>
                    <td className="p-2 text-right">{formatRate(t.success_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Daily */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-4">Daily Breakdown</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-2">Date</th>
                  <th className="text-right p-2">Tasks</th>
                  <th className="text-right p-2">Failures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.daily.map((d, i) => (
                  <tr key={i} className="hover:bg-accent/30 transition-colors">
                    <td className="p-2 font-mono text-[11px] text-muted-foreground">{d.date}</td>
                    <td className="p-2 text-right font-mono">{formatNull(d.tasks)}</td>
                    <td className="p-2 text-right font-mono text-destructive">{formatNull(d.failures)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Egress */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-4">Egress</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Outbound Connections</p>
              <p className="mt-1 text-2xl font-semibold text-foreground">{formatNull(report.egress.outbound_connections)}</p>
            </div>
            <div className="panel p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Source</p>
              <p className="mt-1 text-sm font-mono text-foreground">{formatNull(report.egress.source)}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}