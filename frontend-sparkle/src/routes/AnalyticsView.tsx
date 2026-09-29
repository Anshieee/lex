import { Loader2, BarChart3, TrendingUp, Clock, CheckCircle, XCircle, Database, Cpu } from 'lucide-react';
import { useAnalytics } from '@/lib/api';

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold">{value}</p>
        </div>
      </div>
    </div>
  );
}

function formatMs(ms: number | null | undefined) {
  if (ms == null) return 'Not Recorded';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function rateLabel(rate: number | null | undefined) {
  if (rate == null) return 'Not Recorded';
  return `${rate.toFixed(1)}%`;
}

// Inline SVG time-series sparkline (no external chart library)
function Sparkline({ data, width = 600, height = 120 }: { data: { hour: string; requests: number }[]; width?: number; height?: number }) {
  if (!data.length) return <div className="h-[120px] flex items-center justify-center text-sm text-muted-foreground">No data</div>;
  const max = Math.max(...data.map((d) => d.requests), 1);
  const stepX = width / Math.max(data.length - 1, 1);
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = height - (d.requests / max) * (height - 10) - 5;
    return `${x},${y}`;
  }).join(' ');
  const fillPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[120px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill="url(#sparkGrad)" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
      {data.map((d, i) => {
        const x = i * stepX;
        const y = height - (d.requests / max) * (height - 10) - 5;
        return i % Math.ceil(data.length / 8) === 0 ? (
          <text key={i} x={x} y={height - 2} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.5">
            {new Date(d.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </text>
        ) : null;
      })}
    </svg>
  );
}

export default function AnalyticsView() {
  const { summary, byModel, byTaskType, timeSeries, loading, error } = useAnalytics();

  const totalTasks = Object.values(byModel ?? {}).reduce((s, m) => s + (m.requests ?? 0), 0);

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live inference metrics — latency, success rates, tool-specific stats.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading analytics…
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Requests"
              value={summary?.total_requests ?? '—'}
              icon={Database}
              color="bg-primary/20 text-primary"
            />
            <StatCard
              label="Success Rate"
              value={summary ? `${summary.success_rate.toFixed(1)}%` : '—'}
              icon={CheckCircle}
              color="bg-green-500/20 text-green-400"
            />
            <StatCard
              label="Avg Latency"
              value={formatMs(summary?.avg_latency_ms)}
              icon={Clock}
              color="bg-yellow-500/20 text-yellow-400"
            />
            <StatCard
              label="Total Tasks"
              value={totalTasks || '—'}
              icon={BarChart3}
              color="bg-blue-500/20 text-blue-400"
            />
          </div>

          {/* Time series sparkline */}
          <div>
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Requests Over Time
            </h2>
            <div className="border rounded-lg p-4 text-primary/80">
              <Sparkline data={timeSeries ?? []} />
            </div>
          </div>

          {/* By model table */}
          <div>
            <h2 className="text-sm font-semibold mb-3">By Model</h2>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-panel/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Model</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Requests</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Success %</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byModel ?? {}).map(([name, m]) => (
                    <tr key={name} className="border-b last:border-0 hover:bg-accent/50">
                      <td className="px-3 py-2 font-medium">{name || '(unnamed)'}</td>
                      <td className="px-3 py-2 text-right">{m?.requests ?? 0}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={m?.success_rate == null ? 'text-muted-foreground' : 'text-green-400'}>
                          {rateLabel(m?.success_rate)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{formatMs(m?.avg_latency_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By task type table */}
          <div>
            <h2 className="text-sm font-semibold mb-3">By Task Type</h2>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-panel/50">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Task Type</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Requests</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Success %</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Avg Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byTaskType ?? {}).map(([name, t]) => (
                    <tr key={name} className="border-b last:border-0 hover:bg-accent/50">
                      <td className="px-3 py-2 font-medium">{name}</td>
                      <td className="px-3 py-2 text-right">{t?.requests ?? 0}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={t?.success_rate == null ? 'text-muted-foreground' : 'text-green-400'}>
                          {rateLabel(t?.success_rate)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{formatMs(t?.avg_latency_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
