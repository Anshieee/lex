import { useEffect, useState } from "react";
import { X, Check, ChevronDown, ChevronUp, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PromptCompressionConfig } from "@/lib/agent/types";

interface PromptCompressionModalProps {
  open: boolean;
  onClose: () => void;
  config: PromptCompressionConfig;
  onSave: (config: PromptCompressionConfig) => void;
}

const ENGINE_GROUPS = {
  lossless: [
    {
      key: "repeated_blocks" as const,
      label: "Repeated blocks",
      description: "Deduplicate repeated text blocks across conversation history",
      tag: "dedup",
    },
    {
      key: "whitespace_cleanup" as const,
      label: "Whitespace cleanup",
      description: "Normalize and minimize whitespace in prompts",
      tag: "normalize",
    },
    {
      key: "json_tables" as const,
      label: "JSON tables",
      description: "Compact JSON structures and tabular data (jsoncompact engine)",
      tag: "jsoncompact",
    },
  ],
  lossy: [
    {
      key: "superseded_file_reads" as const,
      label: "Superseded file reads",
      description: "Remove file reads later superseded by newer reads (read-lifecycle engine)",
      tag: "read-lifecycle",
    },
    {
      key: "tool_output_filter" as const,
      label: "Tool output filter",
      description: "Filter verbose tool outputs to keep essential results (toolfilter engine)",
      tag: "toolfilter",
    },
    {
      key: "relevance_filter" as const,
      label: "Relevance filter",
      description: "Remove older turns deemed less relevant (relevance engine)",
      tag: "relevance",
    },
    {
      key: "older_turns" as const,
      label: "Older turns",
      description: "Aggressively truncate older turns beyond recency window (aging engine)",
      tag: "aging",
    },
    {
      key: "token_ceiling" as const,
      label: "Token ceiling",
      description: "Hard token budget ceiling — truncate to fit max tokens (hard-budget engine)",
      tag: "hard-budget",
    },
  ],
} as const;

const MODE_OPTIONS = [
  { value: "Off" as const, label: "Off", description: "No compression applied" },
  { value: "Lossless" as const, label: "Lossless", description: "Only lossless engines (dedup, whitespace, jsoncompact)" },
  { value: "Standard" as const, label: "Standard", description: "Balanced set of engines" },
  { value: "Aggressive" as const, label: "Aggressive", description: "All engines including lossy ones" },
] as const;

export function PromptCompressionModal({
  open,
  onClose,
  config,
  onSave,
}: PromptCompressionModalProps) {
  const [localConfig, setLocalConfig] = useState<PromptCompressionConfig>(config);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    lossless: true,
    lossy: true,
  });

  // Sync local config when props change
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleModeChange = (mode: PromptCompressionConfig["mode"]) => {
    setLocalConfig((prev) => ({ ...prev, mode }));
    // Auto-enable/disable engines based on mode
    if (mode === "Off") {
      setLocalConfig((prev) => ({
        ...prev,
        repeated_blocks: false,
        whitespace_cleanup: false,
        json_tables: false,
        superseded_file_reads: false,
        tool_output_filter: false,
        relevance_filter: false,
        older_turns: false,
        token_ceiling: false,
      }));
    } else if (mode === "Lossless") {
      setLocalConfig((prev) => ({
        ...prev,
        repeated_blocks: true,
        whitespace_cleanup: true,
        json_tables: true,
        superseded_file_reads: false,
        tool_output_filter: false,
        relevance_filter: false,
        older_turns: false,
        token_ceiling: false,
      }));
    } else if (mode === "Standard") {
      setLocalConfig((prev) => ({
        ...prev,
        repeated_blocks: true,
        whitespace_cleanup: true,
        json_tables: true,
        superseded_file_reads: true,
        tool_output_filter: true,
        relevance_filter: false,
        older_turns: false,
        token_ceiling: false,
      }));
    } else if (mode === "Aggressive") {
      setLocalConfig((prev) => ({
        ...prev,
        repeated_blocks: true,
        whitespace_cleanup: true,
        json_tables: true,
        superseded_file_reads: true,
        tool_output_filter: true,
        relevance_filter: true,
        older_turns: true,
        token_ceiling: true,
      }));
    }
  };

  const handleEngineToggle = (key: keyof PromptCompressionConfig, value: boolean) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    onSave(localConfig);
    onClose();
  };

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="panel w-full max-w-2xl max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="text-base font-semibold">Settings</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          <div className="thin-scroll flex-1 overflow-y-auto p-4 space-y-6">
            {/* Prompt Compression Section */}
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">Prompt compression</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Reduce request size before routing while preserving code, errors, paths, numbers, and tool definitions.
                </p>
              </div>

              {/* Mode Selector */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Mode</label>
                <div className="flex gap-2" role="radiogroup" aria-label="Compression mode">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={localConfig.mode === option.value}
                      onClick={() => handleModeChange(option.value)}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-md border text-sm font-medium transition-all",
                        localConfig.mode === option.value
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-accent"
                      )}
                    >
                      <div className="font-medium">{option.label}</div>
                      <div className="text-[10px] opacity-80">{option.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Engines */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">Engines</label>
                  <span className="text-[10px] text-muted-foreground">
                    {Object.values(localConfig).filter((v) => v === true).length - (localConfig.mode !== "Off" ? 1 : 0)} engines enabled
                  </span>
                </div>

                {Object.entries(ENGINE_GROUPS).map(([groupKey, engines]) => (
                  <div key={groupKey} className="border border-border rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))
                      }
                      className="w-full px-3 py-2 bg-muted/50 flex items-center justify-between text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        {groupKey === "lossless" ? (
                          <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px] bg-ok/20 text-ok">Lossless</span>
                        ) : (
                          <span className="rounded-full px-1.5 py-0.5 font-mono text-[9px] bg-warn/20 text-warn">Lossy</span>
                        )}
                        <span className="uppercase">{groupKey}</span>
                      </span>
                      {expandedGroups[groupKey] ? (
                        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>

                    {expandedGroups[groupKey] && (
                      <div className="p-3 space-y-2 border-t border-border">
                        {engines.map((engine) => (
                          <label
                            key={engine.key}
                            className="flex items-start gap-2.5 cursor-pointer rounded-md p-2 hover:bg-accent/50 transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={localConfig[engine.key]}
                              onChange={(e) => handleEngineToggle(engine.key, e.target.checked)}
                              disabled={localConfig.mode === "Off"}
                              className="mt-0.5 h-3.5 w-3.5 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-medium text-foreground">{engine.label}</span>
                                <span className="rounded px-1 py-0.5 font-mono text-[8px] bg-muted text-muted-foreground">
                                  {engine.tag}
                                </span>
                              </div>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">{engine.description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Preview section (placeholder for future) */}
            <section className="border-t border-border pt-4">
              <h3 className="text-sm font-medium text-foreground mb-2">Preview</h3>
              <div className="rounded-md border border-border bg-background/50 p-3 text-[11px] text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Estimated compression impact</p>
                <p>Token reduction will be shown here based on conversation history and selected engines.</p>
              </div>
            </section>
          </div>

          {/* Footer */}
          <div className="shrink-0 flex items-center justify-end gap-2 border-t border-border p-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Check className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Save changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}