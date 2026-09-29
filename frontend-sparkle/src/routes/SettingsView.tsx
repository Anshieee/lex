import { useState, useEffect } from 'react';
import { getUserPreferences, saveUserPreferences } from '@/lib/api';
import { PromptCompressionConfig } from '@/components/PromptCompressionConfig';
import type { PromptCompressionConfig as ConfigType } from '@/lib/types';

export default function SettingsView() {
  const [config, setConfig] = useState<ConfigType>({
    mode: 'Off',
    repeated_blocks: false,
    whitespace_cleanup: false,
    json_tables: false,
    superseded_file_reads: false,
    tool_output_filter: false,
    relevance_filter: false,
    older_turns: false,
    token_ceiling: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getUserPreferences().then((prefs: any) => {
      if (prefs?.prompt_compression) {
        setConfig(prefs.prompt_compression);
      }
    }).catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveUserPreferences({ prompt_compression: config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 thin-scroll">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Prompt Compression */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-1">Prompt Compression</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Control how prompts are compressed before sending to models. Reduces token usage and latency.
          </p>
          <PromptCompressionConfig config={config} onChange={setConfig} />
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
            </button>
            {saved && (
              <span className="text-sm text-ok">Settings applied</span>
            )}
          </div>
        </section>

        {/* App Info */}
        <section className="panel p-5">
          <h2 className="text-base font-semibold mb-3">About</h2>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>Version</span>
              <span className="font-mono">0.1.0</span>
            </div>
            <div className="flex justify-between">
              <span>Backend</span>
              <span className="font-mono">
                {import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8001'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>API Mode</span>
              <span className="font-mono">
                {import.meta.env.VITE_USE_MOCK_API === 'true' ? 'mock' : 'live'}
              </span>
            </div>
            <div className="pt-3 border-t border-border text-xs">
              This is a lightweight client-side SPA. The existing <code className="font-mono bg-muted px-1 rounded">frontend/</code> is a TanStack Start SSR app.
              This project uses pure Vite + React with no SSR dependencies.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
