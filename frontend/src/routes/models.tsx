import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, SlidersHorizontal, Sparkles, Zap, Shield, Brain, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { PromptCompressionModal } from "@/components/dashboard/PromptCompressionModal";

const API_BASE = "http://127.0.0.1:8000";

interface RoutingWeights {
  speed: number;
  reliability: number;
  intelligence: number;
}

interface ScoredModel {
  id: string;
  name: string;
  role: string;
  task_types: string[];
  intelligence: number;
  reliability: number;
  speed: number;
  score: number;
  rank: number;
}

interface RoutingScoresResponse {
  scores: ScoredModel[];
  weights_used: RoutingWeights;
}

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "LEX — Model Routing" },
      { name: "description", content: "Configure dynamic model routing weights and view live scoring." },
    ],
  }),
  component: ModelsPage,
});

function ModelsPage() {
  const [weights, setWeights] = useState<RoutingWeights>({ speed: 33, reliability: 33, intelligence: 34 });
  const [scoredModels, setScoredModels] = useState<ScoredModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
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

  // Fetch user preferences on mount, then fetch scores with those weights
  useEffect(() => {
    const loadPreferencesAndScores = async () => {
      setLoading(true);
      setError(null);
      try {
        // First, try to load user preferences
        const prefRes = await fetch(`${API_BASE}/api/user/preferences`, {
          headers: getAuthHeaders(),
        });
        if (prefRes.ok) {
          const prefData = await prefRes.json();
          if (prefData.routing_weights) {
            setWeights(prefData.routing_weights);
          }
        }
        // Then fetch scores with the loaded weights
        await fetchScoresWithWeights(weights);
      } catch (err: any) {
        // If preferences fail, just fetch default scores
        await fetchScoresWithWeights({ speed: 33, reliability: 33, intelligence: 34 });
      } finally {
        setLoading(false);
      }
    };
    loadPreferencesAndScores();
  }, []);

  const fetchScores = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/models/routing-scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(weights),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RoutingScoresResponse = await res.json();
      setScoredModels(data.scores);
      setWeights(data.weights_used);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleWeightChange = (key: keyof RoutingWeights, value: number) => {
    const newWeights = { ...weights, [key]: value };
    setWeights(newWeights);
    // Debounced fetch - just fetch immediately for now since it's fast
    fetchScoresWithWeights(newWeights);
  };

  const fetchScoresWithWeights = async (newWeights: RoutingWeights) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/models/routing-scores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(newWeights),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: RoutingScoresResponse = await res.json();
      setScoredModels(data.scores);
      setWeights(data.weights_used);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      // Save routing weights
      const res = await fetch(`${API_BASE}/api/user/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          routing_weights: weights,
          prompt_compression: compressionConfig,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const weightConfig = [
    { key: "speed" as const, label: "Speed", icon: Zap, description: "Prefer faster models (lower latency)", color: "text-yellow-400" },
    { key: "reliability" as const, label: "Reliability", icon: Shield, description: "Prefer stable, consistent models", color: "text-green-400" },
    { key: "intelligence" as const, label: "Intelligence", icon: Brain, description: "Prefer more capable models", color: "text-cyan-400" },
  ];

  const totalWeight = weights.speed + weights.reliability + weights.intelligence;

  return (
    <div className="flex min-h-screen flex-col">
      {/* Background nebula effect */}
      <div className="galaxy-nebula pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />
      <div className="galaxy-vignette pointer-events-none fixed inset-0 -z-10" aria-hidden="true" />

      <main className="flex-1 p-4 md:p-6 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted">
                <SlidersHorizontal className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Model Routing</h1>
                <p className="text-xs text-muted-foreground">Configure dynamic weights for multi-objective model selection</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || totalWeight === 0}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? (
              <>
                <Loader2 className="spin-slow h-4 w-4" aria-hidden="true" />
                Saving…
              </>
            ) : saved ? (
              <>
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Saved
              </>
            ) : (
              "Save Preferences"
            )}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Weight Controls */}
          <section className="panel space-y-6" aria-labelledby="weights-heading">
            <h2 id="weights-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Routing Weights
            </h2>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Total Weight</span>
                <span className="font-mono font-semibold">{totalWeight}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, totalWeight)}%`,
                    background: totalWeight > 100 ? "var(--color-destructive)" : "var(--color-primary)",
                  }}
                />
              </div>
              {totalWeight > 100 && (
                <p className="text-xs text-destructive">Weights exceed 100% — they will be normalized</p>
              )}
            </div>

            <div className="space-y-5">
              {weightConfig.map(({ key, label, icon: Icon, description, color }) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("h-4 w-4", color)} aria-hidden="true" />
                      <span className="text-sm font-medium">{label}</span>
                    </div>
                    <span className="font-mono text-sm text-foreground">{weights[key]}%</span>
                  </div>
                  <div className="relative">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={weights[key]}
                      onChange={(e) => handleWeightChange(key, Number(e.target.value))}
                      className="w-full h-2 appearance-none bg-muted rounded-full accent-primary"
                      aria-label={`${label} weight`}
                    />
                    <div className="absolute bottom-full left-0 right-0 mb-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>0</span>
                      <span>50</span>
                      <span>100</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground ml-6">{description}</p>
                </div>
              ))}
            </div>

            <div className="rounded-md border border-border bg-background/50 p-3 text-[11px] text-muted-foreground">
              <p className="font-medium text-foreground mb-1">How it works</p>
              <p>Each model has baseline scores (0–100) for Speed, Reliability, and Intelligence from the registry. The final routing score is:</p>
              <pre className="mt-1.5 font-mono text-[10px] text-primary">
(w_speed × Speed) + (w_reliability × Reliability) + (w_intelligence × Intelligence)
              </pre>
              <p className="mt-1.5">Weights are normalized to sum to 1.0. Higher weight = stronger preference for that trait.</p>
            </div>
          </section>

          {/* Prompt Compression Settings */}
          <section className="panel space-y-6" aria-labelledby="compression-heading">
            <div className="flex items-center justify-between">
              <h2 id="compression-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Prompt Compression
              </h2>
              <button
                type="button"
                onClick={() => setShowCompression(true)}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                Configure Engines
              </button>
            </div>

            <div className="rounded-md border border-border bg-background/50 p-3 text-[11px] text-muted-foreground">
              <p className="font-medium text-foreground mb-1">How it works</p>
              <p>Reduce request size before routing while preserving code, errors, paths, numbers, and tool definitions.</p>
              <p className="mt-1.5">Select a mode or customize individual engines. Engines are applied in order.</p>
            </div>

            {/* Mode selector preview */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground">Mode</label>
              <div className="flex gap-2" role="radiogroup" aria-label="Compression mode">
                {[
                  { value: "Off", label: "Off", desc: "No compression" },
                  { value: "Lossless", label: "Lossless", desc: "Dedup, whitespace, JSON compact" },
                  { value: "Standard", label: "Standard", desc: "Balanced lossless + lossy" },
                  { value: "Aggressive", label: "Aggressive", desc: "All engines including lossy" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={compressionConfig.mode === opt.value}
                    onClick={() => {
                      const newConfig = { ...compressionConfig, mode: opt.value as typeof compressionConfig.mode };
                      // Auto-set engines based on mode
                      if (opt.value === "Off") {
                        newConfig.repeated_blocks = false;
                        newConfig.whitespace_cleanup = false;
                        newConfig.json_tables = false;
                        newConfig.superseded_file_reads = false;
                        newConfig.tool_output_filter = false;
                        newConfig.relevance_filter = false;
                        newConfig.older_turns = false;
                        newConfig.token_ceiling = false;
                      } else if (opt.value === "Lossless") {
                        newConfig.repeated_blocks = true;
                        newConfig.whitespace_cleanup = true;
                        newConfig.json_tables = true;
                        newConfig.superseded_file_reads = false;
                        newConfig.tool_output_filter = false;
                        newConfig.relevance_filter = false;
                        newConfig.older_turns = false;
                        newConfig.token_ceiling = false;
                      } else if (opt.value === "Standard") {
                        newConfig.repeated_blocks = true;
                        newConfig.whitespace_cleanup = true;
                        newConfig.json_tables = true;
                        newConfig.superseded_file_reads = true;
                        newConfig.tool_output_filter = true;
                        newConfig.relevance_filter = false;
                        newConfig.older_turns = false;
                        newConfig.token_ceiling = false;
                      } else if (opt.value === "Aggressive") {
                        newConfig.repeated_blocks = true;
                        newConfig.whitespace_cleanup = true;
                        newConfig.json_tables = true;
                        newConfig.superseded_file_reads = true;
                        newConfig.tool_output_filter = true;
                        newConfig.relevance_filter = true;
                        newConfig.older_turns = true;
                        newConfig.token_ceiling = true;
                      }
                      setCompressionConfig(newConfig);
                    }}
                    className={cn(
                      "flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all",
                      compressionConfig.mode === opt.value
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-accent"
                    )}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-[10px] opacity-80">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Engine count summary */}
            <div className="text-xs text-muted-foreground">
              {(() => {
                const engines = [
                  compressionConfig.repeated_blocks,
                  compressionConfig.whitespace_cleanup,
                  compressionConfig.json_tables,
                  compressionConfig.superseded_file_reads,
                  compressionConfig.tool_output_filter,
                  compressionConfig.relevance_filter,
                  compressionConfig.older_turns,
                  compressionConfig.token_ceiling,
                ].filter(Boolean).length;
                return `${engines} of 8 engines enabled ${compressionConfig.mode === "Off" ? "(mode: Off)" : ""}`;
              })()}
            </div>
          </section>

          {/* Live Model Scoring */}
          <section className="panel" aria-labelledby="scores-heading">
            <div className="flex items-center justify-between mb-4">
              <h2 id="scores-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Live Model Scoring
              </h2>
              {loading && <Loader2 className="spin-slow h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            </div>

            {scoredModels.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <SlidersHorizontal className="h-8 w-8 mb-2 opacity-50" aria-hidden="true" />
                <p className="text-sm">No models available</p>
                <p className="text-[11px]">Check Ollama connection</p>
              </div>
            ) : (
              <div className="space-y-3">
                {scoredModels.map((model) => (
                  <ModelScoreCard key={model.id} model={model} />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Prompt Compression Modal */}
      <PromptCompressionModal
        open={showCompression}
        onClose={() => setShowCompression(false)}
        config={compressionConfig}
        onSave={setCompressionConfig}
      />
    </div>
  );
}

function ModelScoreCard({ model }: { model: ScoredModel }) {
  const scoreColor = model.score >= 75 ? "text-ok" : model.score >= 50 ? "text-warn" : "text-muted-foreground";
  const scoreBg = model.score >= 75 ? "bg-ok/15" : model.score >= 50 ? "bg-warn/15" : "bg-muted";

  return (
    <div className="panel-raised p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-mono text-[9px] font-bold",
                model.rank === 1 ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              #{model.rank}
            </span>
            <h3 className="font-mono text-sm text-foreground truncate">{model.name}</h3>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{model.role}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {model.task_types.map((tt) => (
              <span key={tt} className="rounded px-1.5 py-0.5 font-mono text-[9px] bg-muted text-muted-foreground">
                {tt}
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("font-mono text-xl font-bold", scoreColor)}>{model.score.toFixed(1)}</div>
          <div className="text-[10px] text-muted-foreground">Score</div>
        </div>
      </div>

      {/* Baseline scores bars */}
      <div className="mt-3 space-y-1.5">
        <ScoreBar label="Speed" value={model.speed} color="text-yellow-400" bg="bg-yellow-400/20" />
        <ScoreBar label="Reliability" value={model.reliability} color="text-green-400" bg="bg-green-400/20" />
        <ScoreBar label="Intelligence" value={model.intelligence} color="text-cyan-400" bg="bg-cyan-400/20" />
      </div>
    </div>
  );
}

function ScoreBar({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("shrink-0 text-[10px] font-medium w-20", color)}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", bg)}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-10 text-right">{value}</span>
    </div>
  );
}