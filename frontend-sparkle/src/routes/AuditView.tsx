import { useState, useEffect } from 'react';
import { Loader2, RefreshCw, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import { getAuditVerify, getAuditLog } from '@/lib/api';
import type { AuditVerifyResult, AuditEntry } from '@/lib/types';

export default function AuditView() {
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [verify, log] = await Promise.all([
        getAuditVerify(),
        getAuditLog(50),
      ]);
      setVerifyResult(verify);
      setEntries(log.entries);
    } catch (err: any) {
      setError(err.message || 'Failed to load audit data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6 thin-scroll">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Chain Integrity Badge */}
        <section className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold">Audit Chain Integrity</h2>
            <button
              onClick={loadData}
              disabled={loading}
              className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          {verifyResult ? (
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                verifyResult.valid ? 'bg-ok/15' : 'bg-destructive/15'
              }`}>
                {verifyResult.valid ? (
                  <CheckCircle className="w-6 h-6 text-ok" />
                ) : (
                  <XCircle className="w-6 h-6 text-destructive" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-sm font-medium ${verifyResult.valid ? 'text-ok' : 'text-destructive'}`}>
                    {verifyResult.valid ? 'Chain Valid' : 'Chain Invalid'}
                  </span>
                  {verifyResult.first_invalid_seq !== null && (
                    <span className="text-xs text-muted-foreground">
                      first invalid at seq #{verifyResult.first_invalid_seq}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Entries checked</p>
                    <p className="font-mono font-semibold">{verifyResult.entries_checked}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Chain starts at</p>
                    <p className="font-mono font-semibold">
                      {verifyResult.chain_start_seq !== null ? `seq ${verifyResult.chain_start_seq}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Legacy entries</p>
                    <p className="font-mono font-semibold">{verifyResult.legacy_unhashed_entries}</p>
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
              <Loader2 className="h-4 w-4 spin-slow" />
              <span>Loading verification...</span>
            </div>
          )}
        </section>

        {/* Audit Log */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-4">Recent Audit Log</h2>
          <p className="text-xs text-muted-foreground mb-4">Last {entries.length} entries</p>
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