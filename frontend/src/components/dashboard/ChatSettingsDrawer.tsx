import { X, Mic, MicOff, SlidersHorizontal, Brain, Zap, Database, FileText, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActiveModel } from "@/lib/agent/types";

interface ChatSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  models: ActiveModel[];
  selectedModel: string | null;
  onModelChange: (modelId: string | null) => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  temperature: number;
  onTemperatureChange: (temp: number) => void;
  topP: number;
  onTopPChange: (topP: number) => void;
  maxTokens: number;
  onMaxTokensChange: (tokens: number) => void;
  useDefaultTemperature: boolean;
  onUseDefaultTemperatureChange: (use: boolean) => void;
  useDefaultTopP: boolean;
  onUseDefaultTopPChange: (use: boolean) => void;
  useDefaultMaxTokens: boolean;
  onUseDefaultMaxTokensChange: (use: boolean) => void;
  dictationModel: string;
  onDictationModelChange: (model: string) => void;
}

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_TOP_P = 0.9;
const DEFAULT_MAX_TOKENS = 4096;

export function ChatSettingsDrawer({
  open,
  onClose,
  models,
  selectedModel,
  onModelChange,
  systemPrompt,
  onSystemPromptChange,
  temperature,
  onTemperatureChange,
  topP,
  onTopPChange,
  maxTokens,
  onMaxTokensChange,
  useDefaultTemperature,
  onUseDefaultTemperatureChange,
  useDefaultTopP,
  onUseDefaultTopPChange,
  useDefaultMaxTokens,
  onUseDefaultMaxTokensChange,
  dictationModel,
  onDictationModelChange,
}: ChatSettingsDrawerProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm"
        />
      )}
      <aside
        aria-label="Chat settings"
        aria-hidden={!open}
        className={cn(
          "panel fixed inset-y-3 right-3 z-40 flex w-[min(21rem,calc(100vw-1.5rem))] flex-col transition-transform duration-200",
          open ? "translate-x-0" : "pointer-events-none translate-x-[calc(100%+1rem)]",
        )}
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3">
          <span className="text-sm font-semibold tracking-tight">Settings</span>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-3 pt-0 space-y-6">
          {/* Model Selector */}
          <section className="space-y-3" aria-labelledby="model-heading">
            <h2 id="model-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Model
            </h2>
            <select
              value={selectedModel || ""}
              onChange={(e) => onModelChange(e.target.value || null)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Auto (routing based on weights)</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.role}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              When Auto is selected, the router picks the best model based on task type and weights.
            </p>
          </section>

          {/* Dictation Model */}
          <section className="space-y-3" aria-labelledby="dictation-heading">
            <h2 id="dictation-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Dictation Model
            </h2>
            <select
              value={dictationModel}
              onChange={(e) => onDictationModelChange(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="auto">Auto (fallback chain)</option>
              {models
                .filter((m) => m.task_types.includes("vision_ocr") || m.task_types.includes("general_reasoning"))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
            <p className="text-[10px] text-muted-foreground">
              Used for voice input transcription. Auto selects best available model.
            </p>
          </section>

          {/* System Prompt */}
          <section className="space-y-3" aria-labelledby="system-heading">
            <h2 id="system-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              System Prompt
            </h2>
            <textarea
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              rows={4}
              placeholder="Optional system prompt to guide agent behavior..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              Applied to all agent interactions. Leave empty for default behavior.
            </p>
          </section>

          {/* Sampling Controls */}
          <section className="space-y-4" aria-labelledby="sampling-heading">
            <h2 id="sampling-heading" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sampling
            </h2>

            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">Temperature</span>
                </div>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={useDefaultTemperature}
                    onChange={(e) => onUseDefaultTemperatureChange(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  Default
                </label>
              </div>
              <div className="flex items-center gap-2" data-disabled={useDefaultTemperature}>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={useDefaultTemperature ? DEFAULT_TEMPERATURE : temperature}
                  onChange={(e) => onTemperatureChange(Number(e.target.value))}
                  disabled={useDefaultTemperature}
                  className="flex-1 h-2 appearance-none bg-muted rounded-full accent-primary disabled:opacity-40"
                  aria-label="Temperature"
                />
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground w-10 text-right">
                  {useDefaultTemperature ? DEFAULT_TEMPERATURE.toFixed(1) : temperature.toFixed(1)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground ml-6">
                Higher = more creative, lower = more focused. Default: {DEFAULT_TEMPERATURE}
              </p>
            </div>

            {/* Top P */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">Top P</span>
                </div>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={useDefaultTopP}
                    onChange={(e) => onUseDefaultTopPChange(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  Default
                </label>
              </div>
              <div className="flex items-center gap-2" data-disabled={useDefaultTopP}>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={useDefaultTopP ? DEFAULT_TOP_P : topP}
                  onChange={(e) => onTopPChange(Number(e.target.value))}
                  disabled={useDefaultTopP}
                  className="flex-1 h-2 appearance-none bg-muted rounded-full accent-primary disabled:opacity-40"
                  aria-label="Top P"
                />
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground w-10 text-right">
                  {useDefaultTopP ? DEFAULT_TOP_P.toFixed(2) : topP.toFixed(2)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground ml-6">
                Nucleus sampling threshold. Default: {DEFAULT_TOP_P}
              </p>
            </div>

            {/* Max Tokens */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">Max Tokens</span>
                </div>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={useDefaultMaxTokens}
                    onChange={(e) => onUseDefaultMaxTokensChange(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  Default
                </label>
              </div>
              <div className="flex items-center gap-2" data-disabled={useDefaultMaxTokens}>
                <input
                  type="range"
                  min="128"
                  max="32768"
                  step="128"
                  value={useDefaultMaxTokens ? DEFAULT_MAX_TOKENS : maxTokens}
                  onChange={(e) => onMaxTokensChange(Number(e.target.value))}
                  disabled={useDefaultMaxTokens}
                  className="flex-1 h-2 appearance-none bg-muted rounded-full accent-primary disabled:opacity-40"
                  aria-label="Max tokens"
                />
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground w-14 text-right">
                  {useDefaultMaxTokens ? DEFAULT_MAX_TOKENS : maxTokens}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground ml-6">
                Maximum response length. Default: {DEFAULT_MAX_TOKENS}
              </p>
            </div>
          </section>

          {/* Reset to Defaults */}
          <section>
            <button
              type="button"
              onClick={() => {
                onModelChange(null);
                onSystemPromptChange("");
                onTemperatureChange(DEFAULT_TEMPERATURE);
                onUseDefaultTemperatureChange(true);
                onTopPChange(DEFAULT_TOP_P);
                onUseDefaultTopPChange(true);
                onMaxTokensChange(DEFAULT_MAX_TOKENS);
                onUseDefaultMaxTokensChange(true);
                onDictationModelChange("auto");
              }}
              className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset all to defaults
            </button>
          </section>
        </div>
      </aside>
    </>
  );
}