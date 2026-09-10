import { useEffect, useRef } from "react";
import type { TaskState } from "@/lib/agent/types";

interface P {
  a: number; // angle
  r: number; // orbit radius factor 0..1
  s: number; // speed
  sz: number;
  hue: number;
  drift: number;
}

const STATE_COLOR: Record<TaskState, [number, number, number]> = {
  idle: [150, 200, 235],
  running: [130, 220, 255],
  approval_required: [245, 195, 110],
  failed: [240, 130, 120],
  completed: [140, 240, 190],
};

/**
 * Galaxy Brain — the living visual identity of LEX.
 * Single canvas: a breathing core with orbiting particle arms whose energy
 * reflects the agent state. Large in the empty state, compact during chat.
 */
export function GalaxyBrain({ state, compact }: { state: TaskState; compact: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let raf = 0;
    let particles: P[] = [];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(190, Math.max(70, Math.floor(w * 0.55)));
      particles = Array.from({ length: count }, () => ({
        a: Math.random() * Math.PI * 2,
        r: 0.28 + Math.pow(Math.random(), 0.7) * 0.72,
        s: 0.12 + Math.random() * 0.35,
        sz: 0.5 + Math.random() * 1.4,
        hue: Math.random(),
        drift: (Math.random() - 0.5) * 0.0006,
      }));
    };

    const draw = (t: number) => {
      if (w === 0 || h === 0) resize();
      const st = stateRef.current;
      const [cr, cg, cb] = STATE_COLOR[st];
      const active = st === "running";
      const cx = w / 2;
      const cy = h / 2;
      const max = Math.min(w, h) / 2;

      const beat = reduced ? 0 : Math.sin(t / 1500) * 0.5 + Math.sin(t / 620) * 0.16;
      const breathe = 1 + beat * (active ? 0.075 : 0.045);
      const energy = active ? 1.6 : st === "completed" ? 1.3 : st === "failed" ? 0.7 : 1;

      ctx.clearRect(0, 0, w, h);

      // core glow
      const coreR = max * 0.3 * breathe;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.6);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.55 * energy})`);
      g.addColorStop(0.35, `rgba(${cr},${cg},${cb},0.16)`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 2.6, 0, Math.PI * 2);
      ctx.fill();

      // dense core
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.5 + 0.2 * (beat + 1)})`;
      ctx.fill();

      // orbiting particle arms
      for (const p of particles) {
        if (!reduced) p.a += (p.s * 0.004 * energy) / (0.35 + p.r);
        p.r += p.drift * (reduced ? 0 : 1);
        if (p.r > 1) p.r = 0.28;
        if (p.r < 0.24) p.r = 1;
        const spiral = p.a + p.r * 3.1;
        const rad = p.r * max * 0.92 * breathe;
        const x = cx + Math.cos(spiral) * rad;
        const y = cy + Math.sin(spiral) * rad * 0.62;
        const alpha = (0.2 + 0.55 * (1 - p.r)) * (0.7 + 0.3 * p.hue) * energy;
        ctx.beginPath();
        ctx.arc(x, y, p.sz * (compact ? 0.75 : 1), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(0.9, alpha)})`;
        ctx.fill();
      }

      // approval ring
      if (st === "approval_required") {
        ctx.beginPath();
        ctx.arc(cx, cy, max * 0.62 * breathe, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.45)`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (reduced) draw(0);
    else raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [compact]);

  return <canvas ref={ref} className="h-full w-full" aria-hidden="true" />;
}
