import type { Container, Graphics, Text, Ticker } from "pixi.js";
import { plinkoTable, type PlinkoRisk } from "@hashroll/fair";
import { sfx } from "@/lib/sound";
import { Fx, clamp01, glowCircle, mixColor } from "./fx";
import type { Stage, StageContext } from "./usePixiStage";

export const PLINKO_W = 640;
export const PLINKO_H = 580;
const TOP = 46;
const SLOT_H = 38;

/** Slot color by multiplier: cool for the low center slots, hot for the big edge ones. */
export function slotColor(bps: number): number {
  if (bps >= 100_000) return 0xff2e6e;
  if (bps >= 30_000) return 0xff5a3c;
  if (bps >= 15_000) return 0xff8f1f;
  if (bps >= 10_000) return 0xffc21a;
  if (bps >= 5_000) return 0xa6e22e;
  return 0x2cf0a4;
}

function geometry(rows: number) {
  const gap = (PLINKO_W - 40) / (rows + 2);
  const rowH = Math.min(gap * 0.95, (PLINKO_H - TOP - SLOT_H - 40) / rows);
  const boardH = rows * rowH;
  const top = TOP + (PLINKO_H - TOP - SLOT_H - 30 - boardH) / 2;
  const pegR = Math.max(3, gap * 0.1);
  const ballR = Math.max(6, Math.min(12, gap * 0.22));
  const pegX = (row: number, j: number) => PLINKO_W / 2 + (j - (row + 2) / 2) * gap;
  const rowY = (row: number) => top + row * rowH + rowH * 0.5;
  const slotX = (s: number) => PLINKO_W / 2 + (s - rows / 2) * gap;
  const slotY = top + boardH + 14;
  return { rows, gap, rowH, top, pegR, ballR, pegX, rowY, slotX, slotY };
}
type Geo = ReturnType<typeof geometry>;

interface Peg {
  g: Graphics;
  heat: number;
}

interface Slot {
  c: Container;
  bg: Graphics;
  label: Text;
  color: number;
  bounce: number;
}

export interface PlinkoStage extends Stage {
  setBoard(rows: number, risk: PlinkoRisk): void;
  /** Ball hovers at the top while the house reveals the seed. */
  wait(): void;
  /** Replays the on-chain path; resolves when the ball has landed. */
  drop(path: number[], rows: number, risk: PlinkoRisk): Promise<void>;
  idle(): void;
}

export function createPlinkoStage(ctx: StageContext): PlinkoStage {
  const { PIXI, app, reduced } = ctx;
  const root = new PIXI.Container();
  app.stage.addChild(root);

  const backdrop = new PIXI.Graphics();
  const pegLayer = new PIXI.Container();
  const slotLayer = new PIXI.Container();
  const trail = new PIXI.Graphics();
  trail.blendMode = "add";
  const ball = new PIXI.Container();
  const ballGlow = glowCircle(new PIXI.Graphics(), 0, 0, 10, 0xffd24a, 1.4);
  ballGlow.blendMode = "add";
  const ballBody = new PIXI.Graphics();
  ball.addChild(ballGlow, ballBody);
  ball.visible = false;
  const fx = new Fx(ctx);
  root.addChild(backdrop, pegLayer, slotLayer, trail, ball, fx.layer);

  let geo: Geo = geometry(12);
  let board = { rows: 0, risk: "" as PlinkoRisk | "" };
  let pegs: Peg[][] = [];
  let slots: Slot[] = [];
  let landed: number | null = null;
  let mode: "idle" | "wait" | "drop" = "idle";
  let time = 0;
  let trailPts: { x: number; y: number }[] = [];
  let anim: ((dt: number) => void) | null = null;
  let resolveDrop: (() => void) | null = null;

  const drawBall = () => {
    const r = geo.ballR;
    ballBody.clear();
    ballBody.circle(0, 0, r).fill({ color: 0xffb800 });
    ballBody.circle(0, -r * 0.15, r * 0.78).fill({ color: 0xffd84d });
    ballBody.circle(-r * 0.32, -r * 0.38, r * 0.3).fill({ color: 0xffffff, alpha: 0.85 });
    ballGlow.scale.set(r / 10);
  };

  const build = (rows: number, risk: PlinkoRisk) => {
    if (board.rows === rows && board.risk === risk) return;
    board = { rows, risk };
    geo = geometry(rows);
    landed = null;
    pegLayer.removeChildren().forEach((c) => c.destroy());
    slotLayer.removeChildren().forEach((c) => c.destroy({ children: true }));

    // Soft triangular light behind the pegs.
    backdrop.clear();
    const x0 = geo.pegX(0, 0);
    const x1 = geo.pegX(0, 2);
    const xl = geo.pegX(rows - 1, 0);
    const xr = geo.pegX(rows - 1, rows + 1);
    const yt = geo.rowY(0) - geo.rowH * 0.6;
    const yb = geo.rowY(rows - 1) + geo.rowH * 0.6;
    backdrop
      .poly([x0 - geo.gap * 0.8, yt, x1 + geo.gap * 0.8, yt, xr + geo.gap * 0.8, yb, xl - geo.gap * 0.8, yb])
      .fill({ color: 0x6a5cff, alpha: 0.07 });

    pegs = Array.from({ length: rows }, (_, i) =>
      Array.from({ length: i + 3 }, (_, j) => {
        const g = new PIXI.Graphics();
        glowCircle(g, 0, 0, geo.pegR, 0xb9b4ff, 0.6);
        g.circle(0, 0, geo.pegR).fill({ color: 0xffffff });
        g.position.set(geo.pegX(i, j), geo.rowY(i));
        g.alpha = 0.75;
        pegLayer.addChild(g);
        return { g, heat: 0 };
      }),
    );

    const table = plinkoTable(rows, risk);
    const fontSize = rows === 16 ? 11 : rows === 12 ? 14 : 17;
    slots = table.map((bps, s) => {
      const color = slotColor(bps);
      const c = new PIXI.Container();
      c.position.set(geo.slotX(s), geo.slotY + SLOT_H / 2);
      const bg = new PIXI.Graphics();
      const w = geo.gap - 4;
      bg.roundRect(-w / 2, -SLOT_H / 2 + 4, w, SLOT_H, 7).fill({ color: mixColor(color, 0x000000, 0.55) });
      bg.roundRect(-w / 2, -SLOT_H / 2, w, SLOT_H - 4, 7).fill({ color });
      bg.roundRect(-w / 2 + 3, -SLOT_H / 2 + 3, w - 6, 6, 3).fill({ color: 0xffffff, alpha: 0.25 });
      const mult = bps / 10_000;
      const label = new PIXI.Text({
        text: `${mult >= 1000 ? `${mult / 1000}k` : mult.toLocaleString("en-US", { maximumFractionDigits: mult >= 10 ? 0 : 1 })}${rows <= 12 ? "x" : ""}`,
        style: { fontFamily: ctx.fonts.display, fontSize, fontWeight: "800", fill: 0x1a0f05 },
      });
      label.anchor.set(0.5);
      label.y = -2;
      c.addChild(bg, label);
      slotLayer.addChild(c);
      return { c, bg, label, color, bounce: 0 };
    });
    drawBall();
    if (mode !== "drop") ball.visible = mode === "wait";
  };

  const hitPeg = (row: number, j: number) => {
    const peg = pegs[row]?.[j];
    if (!peg) return;
    peg.heat = 1;
    fx.ring(peg.g.x, peg.g.y, 0xb9b4ff, geo.gap * 0.45, 2);
    sfx.tick(row);
  };

  const finishDrop = (slot: number) => {
    landed = slot;
    const s = slots[slot];
    if (s) {
      s.bounce = 1;
      fx.burst(s.c.x, s.c.y - 6, s.color, 36, 5);
      fx.ring(s.c.x, s.c.y, s.color, geo.gap * 1.4, 4);
    }
    sfx.land();
    ball.visible = false;
    trailPts = [];
    mode = "idle";
    anim = null;
    const r = resolveDrop;
    resolveDrop = null;
    r?.();
  };

  const tick = (t: Ticker) => {
    const dt = t.deltaMS;
    time += dt;
    for (const row of pegs)
      for (const p of row) {
        if (p.heat > 0) p.heat = Math.max(0, p.heat - dt / 350);
        p.g.scale.set(1 + p.heat * 0.7);
        p.g.alpha = 0.75 + p.heat * 0.25;
      }
    slots.forEach((s, i) => {
      if (s.bounce > 0) s.bounce = Math.max(0, s.bounce - dt / 500);
      const b = s.bounce;
      s.c.y = geo.slotY + SLOT_H / 2 + Math.sin(b * Math.PI) * 8;
      s.c.scale.set(1 + Math.sin(b * Math.PI) * 0.12);
      s.c.alpha = landed === null || landed === i ? 1 : 0.55;
    });

    if (mode === "wait") {
      ball.position.set(PLINKO_W / 2 + Math.sin(time / 180) * 6, geo.top - 22 + Math.sin(time / 90) * 3);
      ballGlow.alpha = 0.7 + Math.sin(time / 120) * 0.3;
    }
    anim?.(dt);

    trail.clear();
    if (mode === "drop") {
      trailPts.unshift({ x: ball.x, y: ball.y });
      trailPts = trailPts.slice(0, 12);
      trailPts.forEach((p, i) => trail.circle(p.x, p.y, geo.ballR * (1 - i / 14)).fill({ color: 0xffa600, alpha: 0.22 * (1 - i / 12) }));
    }
  };
  app.ticker.add(tick);

  build(12, "medium");

  return {
    setBoard: (rows, risk) => build(rows, risk),

    wait() {
      landed = null;
      mode = "wait";
      ball.visible = true;
      ball.scale.set(1);
    },

    idle() {
      if (mode === "drop") return;
      mode = "idle";
      ball.visible = false;
    },

    drop(path, rows, risk) {
      build(rows, risk);
      resolveDrop?.();
      return new Promise<void>((resolve) => {
        resolveDrop = resolve;
        const slot = path.reduce((a, b) => a + b, 0);
        if (reduced) {
          finishDrop(slot);
          return;
        }
        mode = "drop";
        landed = null;
        ball.visible = true;

        // Contact points: just above each peg the ball hits, then the slot.
        const pts: { x: number; y: number; row: number; peg: number }[] = [
          { x: ball.x || PLINKO_W / 2, y: ball.y || geo.top - 22, row: -1, peg: -1 },
        ];
        let k = 0;
        for (let i = 0; i < rows; i++) {
          pts.push({ x: PLINKO_W / 2 + (k - i / 2) * geo.gap, y: geo.rowY(i) - geo.pegR - geo.ballR, row: i, peg: k + 1 });
          k += path[i];
        }
        pts.push({ x: geo.slotX(k), y: geo.slotY + 4, row: rows, peg: -1 });

        const seg = Math.max(95, Math.min(190, 2_000 / (rows + 1)));
        let elapsed = 0;
        let segIndex = 0;
        anim = (dt) => {
          elapsed += dt;
          let i = Math.floor(elapsed / seg);
          while (segIndex < i && segIndex < pts.length - 1) {
            segIndex++;
            const p = pts[segIndex];
            if (p.row >= 0 && p.row < rows) hitPeg(p.row, p.peg);
          }
          if (i >= pts.length - 1) {
            finishDrop(k);
            return;
          }
          i = Math.min(i, pts.length - 2);
          const u = clamp01((elapsed - i * seg) / seg);
          const a = pts[i];
          const b = pts[i + 1];
          // Horizontal drift is linear; vertically a small hop off the peg, then gravity.
          const hop = i === 0 ? 0 : geo.rowH * 0.42;
          const y = i === 0 ? a.y + (b.y - a.y) * u * u : a.y + (b.y - a.y) * u - 4 * hop * u * (1 - u);
          ball.position.set(a.x + (b.x - a.x) * u, y);
          ball.rotation += dt * 0.01 * (b.x > a.x ? 1 : -1);
        };
      });
    },

    destroy() {
      app.ticker.remove(tick);
      fx.destroy();
      const r = resolveDrop;
      resolveDrop = null;
      r?.();
    },
  };
}
