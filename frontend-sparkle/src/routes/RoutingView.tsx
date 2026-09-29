import { useState, useEffect, useCallback } from 'react';
import { getModels, getModelStats, getRoutingScores, saveUserPreferences, getUserPreferences } from '@/lib/api';
import type { ModelEntry, ModelStats, RoutingWeights } from '@/lib/types';
import RoutingSliders from '@/components/RoutingSliders';

export default function RoutingView() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [stats, setStats] = useState<Record<string, ModelStats>>({});
  const [weights, setWeights] = useState<RoutingWeights>({ speed: 33, reliability: 33, intelligence: 34 });
  const [scores, setScores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [modelsRes, statsRes, prefsRes] = await Promise.all([
        getModels(),
        getModelStats(),
        getUserPreferences(),
      ]);
      setModels(modelsRes.models);
      setStats(statsRes.models);
      if (prefsRes?.routing_weights) {
        setWeights(prefsRes.routing_weights);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleWeightChange = useCallback(async (newWeights: RoutingWeights) => {
    setWeights(newWeights);
    try {
      const res = await getRoutingScores(newWeights);
      setScores(res.scores);
      await saveUserPreferences({ routing_weights: newWeights });
    } catch (err) {
      console.error('Failed to save weights:', err);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="w-4 h-4 rounded-full bg-primary pulse" />
          <span>Loading models...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-destructive">
          <p className="font-medium">Failed to load</p>
          <p className="text-sm mt-1 opacity-80">{error}</p>
          <button onClick={loadData} className="mt-4 px-4 py-2 rounded-md bg-accent text-sm hover:bg-accent/80">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 thin-scroll">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Routing Weights */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-1">Routing Weights</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Adjust priorities to influence which model handles each task type.
          </p>
          <RoutingSliders weights={weights} onChange={handleWeightChange} />
          <div className="mt-4 flex gap-6 text-xs text-muted-foreground">
            <span>Speed → favors faster inference</span>
            <span>Reliability → favors stable models</span>
            <span>Intelligence → favors capable models</span>
          </div>
        </section>

        {/* Model Registry */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-1">Model Registry</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Available models with live routing scores based on your weights.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th className="text-left p-2">Model</th>
                  <th className="text-left p-2 hidden md:table-cell">Role</th>
                  <th className="text-left p-2">State</th>
                  <th className="text-right p-2">Score</th>
                  <th className="text-right p-2 hidden lg:table-cell">VRAM</th>
                  <th className="text-right p-2 hidden lg:table-cell">Requests</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {models.map((model) => {
                  const stat = stats[model.name];
                  const score = scores.find((s: any) => s.id === model.id)?.score ?? 75;
                  return (
                    <tr key={model.id} className="hover:bg-accent/30 transition-colors">
                      <td className="p-2 font-mono text-[11px]">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            model.state === 'loaded' ? 'bg-ok' :
                            model.state === 'idle' ? 'bg-muted-foreground' : 'bg-destructive'
                          }`} />
                          {model.name}
                        </div>
                      </td>
                      <td className="p-2 text-muted-foreground hidden md:table-cell max-w-48 truncate">
                        {model.role || '—'}
                      </td>
                      <td className="p-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          model.state === 'loaded' ? 'bg-ok/15 text-ok' :
                          model.state === 'idle' ? 'bg-muted text-muted-foreground' :
                          'bg-destructive/15 text-destructive'
                        }`}>
                          {model.state}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono">
                        <div className="inline-flex items-center gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${score}%` }}
                            />
                          </div>
                          <span className="text-xs">{score}</span>
                        </div>
                      </td>
                      <td className="p-2 text-right font-mono text-xs text-muted-foreground hidden lg:table-cell">
                        {model.vram_usage_mb > 0 ? `${model.vram_usage_mb} MB` : 'CPU'}
                      </td>
                      <td className="p-2 text-right font-mono text-xs hidden lg:table-cell">
                        {stat?.requests ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
