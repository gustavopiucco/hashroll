import type { Container, Graphics, Ticker } from "pixi.js";
import type { StageContext } from "./usePixiStage";

export const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);
export const easeOutQuart = (k: number) => 1 - Math.pow(1 - k, 4);
export const easeOutBack = (k: number) => {
  const c = 1.9;
  return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
};
export const clamp01 = (k: number) => Math.max(0, Math.min(1, k));

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  max: number;
  gravity: number;
}

interface Ring {
  g: Graphics;
  life: number;
  max: number;
  radius: number;
}

/**
 * Additive particle bursts and shockwave rings drawn on top of a stage. One instance per stage;
 * it registers itself on the app ticker and cleans up in destroy().
 */
export class Fx {
  readonly layer: Container;
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private tick = (t: Ticker) => this.update(t.deltaMS);

  constructor(private ctx: StageContext) {
    this.layer = new ctx.PIXI.Container();
    this.layer.blendMode = "add";
    ctx.app.ticker.add(this.tick);
  }

  burst(x: number, y: number, color: number, count = 24, speed = 4, gravity = 0.12) {
    if (this.ctx.reduced) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const g = new this.ctx.PIXI.Graphics().circle(0, 0, 1.5 + Math.random() * 2.5).fill({ color });
      g.position.set(x, y);
      this.layer.addChild(g);
      const max = 500 + Math.random() * 500;
      this.particles.push({ g, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.4, life: max, max, gravity });
    }
  }

  ring(x: number, y: number, color: number, radius = 60, width = 3) {
    if (this.ctx.reduced) return;
    const g = new this.ctx.PIXI.Graphics().circle(0, 0, 10).stroke({ width, color });
    g.position.set(x, y);
    this.layer.addChild(g);
    this.rings.push({ g, life: 450, max: 450, radius });
  }

  private update(dt: number) {
    const f = dt / 16.67;
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        p.g.destroy();
        return false;
      }
      p.vy += p.gravity * f;
      p.vx *= 0.985;
      p.g.x += p.vx * f;
      p.g.y += p.vy * f;
      p.g.alpha = p.life / p.max;
      return true;
    });
    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) {
        r.g.destroy();
        return false;
      }
      const k = 1 - r.life / r.max;
      r.g.scale.set((easeOutCubic(k) * r.radius) / 10 + 0.1);
      r.g.alpha = 1 - k;
      return true;
    });
  }

  destroy() {
    this.ctx.app.ticker.remove(this.tick);
  }
}

/** Soft glow behind a shape: a few stacked translucent circles (cheaper than a blur filter). */
export function glowCircle(g: Graphics, x: number, y: number, r: number, color: number, strength = 1, spread = 0.45) {
  for (let i = 4; i >= 1; i--) g.circle(x, y, r * (1 + i * spread)).fill({ color, alpha: 0.06 * strength });
  return g;
}

/** Linear interpolation between two 0xRRGGBB colors. */
export function mixColor(a: number, b: number, k: number) {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k) << s;
  return m(16) | m(8) | m(0);
}
