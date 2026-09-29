import { useState, useEffect } from 'react';
import { getAuditLog, getAuditVerify } from '@/lib/api';
import type { AuditEntry, AuditVerifyResult } from '@/lib/types';

export default function ApprovalView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [logRes, verifyRes] = await Promise.all([
        getAuditLog(50),
        getAuditVerify(),
      ]);
      setEntries(logRes.entries);
      setVerifyResult(verifyRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 thin-scroll">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Chain Integrity Badge */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-3">Audit Chain Integrity</h2>
          {verifyResult ? (
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                verifyResult.valid ? 'bg-ok/15' : 'bg-destructive/15'
              }`}>
                {verifyResult.valid ? (
                  <svg className="w-5 h-5 text-ok" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-sm font-medium ${verifyResult.valid ? 'text-ok' : 'text-destructive'}`}>
                    {verifyResult.valid ? 'Chain Valid' : 'Chain Invalid'}
                  </span>
                  {verifyResult.first_invalid_seq !== null && (
                    <span className="text-xs text-muted-foreground">
                      at seq #{verifyResult.first_invalid_seq}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Entries checked</p>
                    <p className="font-mono font-semibold">{verifyResult.entries_checked}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Chain starts</p>
                    <p className="font-mono font-semibold">
                      {verifyResult.chain_start_seq ?? '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Legacy entries</p>
                    <p className="font-mono font-semibold">
                      {verifyResult.legacy_unhashed_entries}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Integrity</p>
                    <p className={`font-mono font-semibold ${verifyResult.valid ? 'text-ok' : 'text-destructive'}`}>
                      {verifyResult.valid ? 'secure' : 'compromised'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-muted-foreground">
              <div className="w-4 h-4 rounded-full bg-primary pulse" />
              <span>Loading verification...</span>
            </div>
          )}
        </section>

        {/* Audit Log */}
        <section className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold">Recent Audit Log</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last {entries.length} entries from tamper-evident chain
              </p>
            </div>
            <button
              onClick={loadData}
              disabled={loading}
              className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent disabled:opacity-50 transition-colors"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          {entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No audit entries found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="text-left p-2">Time</th>
                    <th className="text-left p-2">Task ID</th>
                    <th className="text-left p-2">Step</th>
                    <th className="text-left p-2 hidden md:table-cell">Model</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-right p-2 hidden lg:table-cell">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry, i) => (
                    <tr key={i} className="hover:bg-accent/30 transition-colors">
                      <td className="p-2 font-mono text-[11px] text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleString()}
                      </td>
                      <td className="p-2 font-mono text-[11px]">{entry.task_id}</td>
                      <td className="p-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                          {entry.step_type}
                        </span>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground hidden md:table-cell max-w-32 truncate">
                        {entry.model_used || '—'}
                      </td>
                      <td className="p-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          entry.status === 'success' ? 'bg-ok/15 text-ok' :
                          entry.status === 'failed' ? 'bg-destructive/15 text-destructive' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-muted-foreground hidden lg:table-cell">
                        {entry.duration_ms > 0 ? `${entry.duration_ms}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
