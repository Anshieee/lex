import { useState } from 'react';
import { Loader2, Zap, Shield, Brain, Cpu, HardDrive, MemoryStick, AlertCircle } from 'lucide-react';
import { fetchModelRegistry, fetchRoutingScores, useModelRegistry, useRoutingScores } from '@/lib/api';
import type { ModelEntry, RoutingWeights, RoutingScoredModel } from '@/lib/types';

const WEIGHT_PRESETS: Record<string, RoutingWeights> = {
  balanced: { speed: 33, reliability: 33, intelligence: 34 },
  reliability: { speed: 10, reliability: 80, intelligence: 10 },
  speed: { speed: 80, reliability: 10, intelligence: 10 },
  intelligence: { speed: 10, reliability: 10, intelligence: 80 },
};

function StateBadge({ state }: { state: ModelEntry['state'] }) {
  const styles: Record<ModelEntry['state'], string> = {
    loaded: 'bg-green-500/20 text-green-400 border-green-500/30',
    idle: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    available: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    unavailable: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${styles[state]}`}>
      <span className={`w-1.5 h-1.5 rounded-full bg-current ${state === 'loaded' ? 'animate-pulse' : ''}`} />
      {state}
    </span>
  );
}

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-accent overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-7 text-right">{value}</span>
    </div>
  );
}

export default function ModelsView() {
  const [manualWeights, setManualWeights] = useState<RoutingWeights>(WEIGHT_PRESETS.balanced);
  const [manualScores, setManualScores] = useState<RoutingScoredModel[] | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState('balanced');

  const { models, loading: registryLoading, error: registryError } = useModelRegistry();
  const { scores, weightsUsed, loading: scoresLoading, error: scoresError } = useRoutingScores(manualWeights);

  const handlePreset = (preset: string) => {
    setActivePreset(preset);
    const w = WEIGHT_PRESETS[preset];
    if (w) {
      setManualWeights(w);
    }
  };

  const handleManualScore = async () => {
    setManualLoading(true);
    setManualError(null);
    try {
      const res = await fetchRoutingScores(manualWeights);
      setManualScores(res.scores);
    } catch (e: any) {
      setManualError(e.message ?? 'Failed to fetch scores');
      setManualScores(null);
    } finally {
      setManualLoading(false);
    }
  };

  const formatSize = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Model Routing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Dynamic model selection based on routing weights and live registry status.
        </p>
      </div>

      {/* Presets + manual controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">Presets:</span>
        {(Object.keys(WEIGHT_PRESETS) as string[]).map((name) => (
          <button
            key={name}
            onClick={() => handlePreset(name)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              activePreset === name
                ? 'bg-primary/20 text-primary border-primary/30'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {scoresLoading && <Loader2 className="w-3 h-3 animate-spin" />}
          {weightsUsed && (
            <span>S:{weightsUsed.speed} R:{weightsUsed.reliability} I:{weightsUsed.intelligence}</span>
          )}
        </div>
      </div>

      {/* Scores table */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Live Routing Scores</h2>
        {(scoresLoading || manualLoading) && (
          <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Computing scores…
          </div>
        )}
        {scoresError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {scoresError}
          </div>
        )}
        {!scoresLoading && scores?.length ? (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-panel/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Rank</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Model</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Role</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Int</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Rel</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Spd</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Score</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-accent/50">
                    <td className="px-3 py-2 font-mono text-muted-foreground">#{m.rank}</td>
                    <td className="px-3 py-2 font-medium">{m.name}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">{m.role || '—'}</td>
                    <td className="px-3 py-2"><ScoreBar value={m.intelligence} color="bg-cyan-400" /></td>
                    <td className="px-3 py-2"><ScoreBar value={m.reliability} color="bg-green-400" /></td>
                    <td className="px-3 py-2"><ScoreBar value={m.speed} color="bg-yellow-400" /></td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{m.score.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !manualLoading && !scoresError ? (
          <div className="py-8 text-sm text-muted-foreground text-center">No scores yet — adjust weights above.</div>
        ) : null}
      </div>

      {/* Registry */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Model Registry</h2>
        {registryLoading && (
          <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading registry…
          </div>
        )}
        {registryError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {registryError}
          </div>
        )}
        {!registryLoading && models?.length ? (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-panel/50">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">ID</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">State</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Context</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Resident</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">VRAM</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Task Types</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-accent/50">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{m.id}</td>
                    <td className="px-3 py-2 font-medium">{m.name}</td>
                    <td className="px-3 py-2"><StateBadge state={m.state} /></td>
                    <td className="px-3 py-2 text-xs">{m.ctx_window ? `${m.ctx_window.toLocaleString()}` : 'Not Recorded'}</td>
                    <td className="px-3 py-2">
                      {m.resident ? (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <Cpu className="w-3 h-3" /> Resident
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not Resident</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-right">
                      {formatSize(m.vram_usage_mb)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {m.task_types.map((t) => (
                          <span key={t} className="px-1.5 py-0.5 rounded text-xs bg-accent text-muted-foreground">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !registryLoading && !registryError ? (
          <div className="py-8 text-sm text-muted-foreground text-center">No models registered.</div>
        ) : null}
      </div>
    </div>
  );
}
