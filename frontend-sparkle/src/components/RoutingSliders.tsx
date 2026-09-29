import { Slider } from '@/components/ui/Slider';
import type { RoutingWeights } from '@/lib/types';

interface RoutingSlidersProps {
  weights: RoutingWeights;
  onChange: (weights: RoutingWeights) => void;
}

const WEIGHTS = [
  { key: 'speed' as const, label: 'Speed', desc: 'Prioritize faster inference', color: 'text-blue-400' },
  { key: 'reliability' as const, label: 'Reliability', desc: 'Prioritize stable models', color: 'text-ok' },
  { key: 'intelligence' as const, label: 'Intelligence', desc: 'Prioritize capable models', color: 'text-primary' },
];

export default function RoutingSliders({ weights, onChange }: RoutingSlidersProps) {
  const handleChange = (key: keyof RoutingWeights, value: number) => {
    const newWeights = { ...weights, [key]: value };
    // Normalize so values sum to 100
    const sum = newWeights.speed + newWeights.reliability + newWeights.intelligence;
    if (sum !== 100 && sum > 0) {
      const factor = 100 / sum;
      onChange({
        speed: Math.round(newWeights.speed * factor),
        reliability: Math.round(newWeights.reliability * factor),
        intelligence: 100 - Math.round(newWeights.speed * factor) - Math.round(newWeights.reliability * factor),
      });
    } else {
      onChange(newWeights);
    }
  };

  return (
    <div className="space-y-4">
      {WEIGHTS.map(({ key, label, desc, color }) => (
        <div key={key} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${color}`}>{label}</span>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
            <span className="font-mono text-sm tabular-nums">{weights[key]}</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={1}
            value={[weights[key]]}
            onValueChange={([v]) => handleChange(key, v)}
            className="w-full"
          />
        </div>
      ))}
    </div>
  );
}
