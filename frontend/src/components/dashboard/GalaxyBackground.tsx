import { useEffect, useRef } from "react";
import type { TaskState } from "@/lib/agent/types";

interface Star {
  x: number;
  y: number;
  r: number;
  baseAlpha: number;
  phase: number;
  vx: number;
  vy: number;
  depth: number;
}

/**
 * Ambient deep-space layer: one canvas, low-density drifting stars, subtle
 * nebula gradients via CSS, pointer parallax (few px), activity-aware glow.
 * Honors prefers-reduced-motion (renders a single static frame).
 */
export function GalaxyBackground({ activity }: { activity: TaskState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activityRef = useRef(activity);
  activityRef.current = activity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isTouch = window.matchMedia("(pointer: coarse)").matches;

    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    let raf = 0;
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.floor((w * h) / 14000); // low density
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.3,
        baseAlpha: 0.25 + Math.random() * 0.5,
        phase: Math.random() * Math.PI * 2,
        vx: (Math.random() - 0.5) * 0.03,
        vy: (Math.random() - 0.5) * 0.02,
        depth: 0.3 + Math.random() * 0.7,
      }));
    };

    const onPointer = (e: PointerEvent) => {
      if (isTouch) return;
      tx = (e.clientX / window.innerWidth - 0.5) * 8;
      ty = (e.clientY / window.innerHeight - 0.5) * 8;
    };

    const draw = (t: number) => {
      const active = activityRef.current === "running" || activityRef.current === "approval_required";
      const speed = active ? 2.2 : 1;
      ctx.clearRect(0, 0, w, h);
      px += (tx - px) * 0.04;
      py += (ty - py) * 0.04;

      for (const s of stars) {
        s.x += s.vx * speed;
        s.y += s.vy * speed;
        if (s.x < -4) s.x = w + 4;
        if (s.x > w + 4) s.x = -4;
        if (s.y < -4) s.y = h + 4;
        if (s.y > h + 4) s.y = -4;

        const twinkle = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(t / 1400 + s.phase);
        const glow = active ? 1.35 : 1;
        const alpha = Math.min(1, s.baseAlpha * twinkle * glow);
        ctx.beginPath();
        ctx.arc(s.x + px * s.depth, s.y + py * s.depth, s.r * (active ? 1.15 : 1), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(190, 210, 255, ${alpha})`;
        ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointer);
    if (reduced) {
      draw(0);
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
      <div className="galaxy-nebula absolute inset-0" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="galaxy-vignette absolute inset-0" />
    </div>
  );
}
