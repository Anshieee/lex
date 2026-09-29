import { useState } from 'react';
import type { PromptCompressionConfig } from '@/lib/types';

interface Props {
  config: PromptCompressionConfig;
  onChange: (config: PromptCompressionConfig) => void;
}

const ENGINE_GROUPS = {
  lossless: [
    { key: 'repeated_blocks' as const, label: 'Repeated blocks', desc: 'Deduplicate repeated text blocks' },
    { key: 'whitespace_cleanup' as const, label: 'Whitespace cleanup', desc: 'Normalize whitespace in prompts' },
    { key: 'json_tables' as const, label: 'JSON tables', desc: 'Compact JSON and tabular data' },
  ],
  lossy: [
    { key: 'superseded_file_reads' as const, label: 'Superseded file reads', desc: 'Remove outdated file reads' },
    { key: 'tool_output_filter' as const, label: 'Tool output filter', desc: 'Filter verbose tool outputs' },
    { key: 'relevance_filter' as const, label: 'Relevance filter', desc: 'Remove less relevant turns' },
    { key: 'older_turns' as const, label: 'Older turns', desc: 'Truncate old conversation history' },
    { key: 'token_ceiling' as const, label: 'Token ceiling', desc: 'Hard token budget limit' },
  ],
};

const PRESETS: Record<'Off' | 'Lossless' | 'Standard' | 'Aggressive', PromptCompressionConfig> = {
  Off: { mode: 'Off', repeated_blocks: false, whitespace_cleanup: false, json_tables: false, superseded_file_reads: false, tool_output_filter: false, relevance_filter: false, older_turns: false, token_ceiling: false },
  Lossless: { mode: 'Lossless', repeated_blocks: true, whitespace_cleanup: true, json_tables: true, superseded_file_reads: false, tool_output_filter: false, relevance_filter: false, older_turns: false, token_ceiling: false },
  Standard: { mode: 'Standard', repeated_blocks: true, whitespace_cleanup: true, json_tables: true, superseded_file_reads: false, tool_output_filter: true, relevance_filter: false, older_turns: false, token_ceiling: false },
  Aggressive: { mode: 'Aggressive', repeated_blocks: true, whitespace_cleanup: true, json_tables: true, superseded_file_reads: true, tool_output_filter: true, relevance_filter: true, older_turns: true, token_ceiling: true },
};

export function PromptCompressionConfig({ config, onChange }: Props) {
  const [mode, setMode] = useState<'custom' | 'Off' | 'Lossless' | 'Standard' | 'Aggressive'>(
    config.mode === 'Off' ? 'Off' : 'custom'
  );

  const applyMode = (m: 'Off' | 'Lossless' | 'Standard' | 'Aggressive') => {
    setMode(m);
    onChange(PRESETS[m]);
  };

  const toggle = (key: keyof PromptCompressionConfig) => {
    if (mode !== 'custom') setMode('custom');
    onChange({ ...config, [key]: !config[key] });
  };

  return (
    <div className="space-y-4">
      {/* Preset modes */}
      <div className="flex flex-wrap gap-2">
        {(['Off', 'Lossless', 'Standard', 'Aggressive'] as const).map((m) => (
          <button
            key={m}
            onClick={() => applyMode(m)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              mode === m
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Lossless engines */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Lossless engines</p>
        <div className="space-y-2">
          {ENGINE_GROUPS.lossless.map(({ key, label, desc }) => (
            <label key={key} className="flex items-start gap-3 p-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={config[key]}
                onChange={() => toggle(key)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Lossy engines */}
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">Lossy engines</p>
        <div className="space-y-2">
          {ENGINE_GROUPS.lossy.map(({ key, label, desc }) => (
            <label key={key} className="flex items-start gap-3 p-2 rounded-md hover:bg-accent/50 cursor-pointer transition-colors">
              <input
                type="checkbox"
                checked={config[key]}
                onChange={() => toggle(key)}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-ring"
              />
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}