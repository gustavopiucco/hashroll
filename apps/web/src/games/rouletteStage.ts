import type { Graphics, Ticker } from "pixi.js";
import { rouletteColor } from "@hashroll/fair";
import { sfx } from "@/lib/sound";
import { Fx, clamp01, glowCircle } from "./fx";
import type { Stage, StageContext } from "./usePixiStage";

/** Pocket order of a European wheel, clockwise from zero. */
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const ROULETTE_SIZE = 520;
const C = ROULETTE_SIZE / 2;
const SECTOR = (Math.PI * 2) / WHEEL.length;
const TAU = Math.PI * 2;
const R_RIM = 250;
const R_TRACK_OUT = 238;
const R_BALL_TRACK = 220;
const R_POCKET_OUT = 200;
const R_POCKET_IN = 150;
const R_BALL_POCKET = 172;
const BALL_R = 8;

export const POCKET_COLOR = { red: 0xd61f3c, black: 0x1a1a24, green: 0x14a85a } as const;

const easeOutBounce = (k: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
};

/** Point at `r` and `angle` (0 = top, clockwise) around the wheel's center. */
const at = (r: number, angle: number) => ({ x: C + r * Math.sin(angle), y: C - r * Math.cos(angle) });

function sector(g: Graphics, r1: number, r2: number, a0: number, a1: number) {
  // Pixi arcs measure from +x; ours from the top.
  return g
    .arc(0, 0, r2, a0 - Math.PI / 2, a1 - Math.PI / 2)
    .arc(0, 0, r1, a1 - Math.PI / 2, a0 - Math.PI / 2, true)
    .closePath();
}

export interface RouletteStage extends Stage {
  /** Wheel and ball spin while the house reveals the seed. */
  spin(): void;
  /** Slows down so the ball settles in the on-chain number's pocket; resolves when it rests. */
  land(n: number): Promise<void>;
  idle(): void;
}

export function createRouletteStage(ctx: StageContext): RouletteStage {
  const { PIXI, app, reduced } = ctx;
  const root = new PIXI.Container();
  app.stage.addChild(root);
  const fx = new Fx(ctx);

  // Static rim and ball track.
  const rim = new PIXI.Graphics();
  glowCircle(rim, C, C, R_RIM - 2, 0xffb43c, 0.8, 0.012);
  rim.circle(C, C, R_RIM).fill({ color: 0x6b3d12 });
  rim.circle(C, C, R_RIM - 4).fill({ color: 0xc98a2e });
  rim.circle(C, C, R_RIM - 8).fill({ color: 0x4a2a0c });
  rim.circle(C, C, R_TRACK_OUT).fill({ color: 0x1c1008 });
  rim.circle(C, C, R_TRACK_OUT - 3).fill({ color: 0x2b1a0c });
  for (let i = 0; i < 8; i++) {
    const p = at(R_BALL_TRACK + 6, (i * TAU) / 8 + TAU / 16);
    rim.poly([p.x - 5, p.y, p.x, p.y - 5, p.x + 5, p.y, p.x, p.y + 5]).fill({ color: 0xe8b04a });
  }

  // Rotating wheel: pockets, numbers, frets and the center cone.
  const wheel = new PIXI.Container();
  wheel.position.set(C, C);
  const pockets = new PIXI.Graphics();
  WHEEL.forEach((n, i) => {
    const a0 = i * SECTOR - SECTOR / 2;
    sector(pockets, R_POCKET_IN, R_POCKET_OUT, a0, a0 + SECTOR).fill({ color: POCKET_COLOR[rouletteColor(n)] });
  });
  // Inner pocket floor (where the ball rests) is slightly darker.
  WHEEL.forEach((n, i) => {
    const a0 = i * SECTOR - SECTOR / 2;
    sector(pockets, R_POCKET_IN, R_POCKET_IN + 34, a0, a0 + SECTOR).fill({ color: 0x000000, alpha: 0.25 });
  });
  for (let i = 0; i < WHEEL.length; i++) {
    const a = i * SECTOR - SECTOR / 2;
    const p0 = { x: R_POCKET_IN * Math.sin(a), y: -R_POCKET_IN * Math.cos(a) };
    const p1 = { x: R_POCKET_OUT * Math.sin(a), y: -R_POCKET_OUT * Math.cos(a) };
    pockets.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({ width: 2, color: 0xe8c36a });
  }
  pockets.circle(0, 0, R_POCKET_OUT).stroke({ width: 3, color: 0xe8c36a });
  pockets.circle(0, 0, R_POCKET_IN + 34).stroke({ width: 1.5, color: 0xe8c36a, alpha: 0.7 });
  const highlight = new PIXI.Graphics();
  highlight.blendMode = "add";
  const labels = new PIXI.Container();
  WHEEL.forEach((n, i) => {
    const t = new PIXI.Text({ text: String(n), style: { fontFamily: ctx.fonts.display, fontSize: 15, fontWeight: "800", fill: 0xffffff } });
    t.anchor.set(0.5);
    const a = i * SECTOR;
    t.position.set(191 * Math.sin(a) * 0.95, -191 * Math.cos(a) * 0.95);
    t.rotation = a;
    labels.addChild(t);
  });
  const cone = new PIXI.Graphics();
  cone.circle(0, 0, R_POCKET_IN).fill({ color: 0x3a220c });
  cone.circle(0, 0, R_POCKET_IN - 6).fill({ color: 0x5a3412 });
  cone.circle(0, 0, 92).fill({ color: 0x2a1708 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    cone.moveTo(-118 * Math.cos(a), -118 * Math.sin(a)).lineTo(118 * Math.cos(a), 118 * Math.sin(a)).stroke({ width: 6, color: 0xe8b04a });
  }
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    cone.circle(118 * Math.cos(a), 118 * Math.sin(a), 7).fill({ color: 0xffd27a });
  }
  wheel.addChild(pockets, highlight, labels, cone);

  // Center hub (does not rotate): shows the result number.
  const hub = new PIXI.Container();
  hub.position.set(C, C);
  const hubBg = new PIXI.Graphics();
  const hubText = new PIXI.Text({ text: "", style: { fontFamily: ctx.fonts.display, fontSize: 64, fontWeight: "900", fill: 0xffffff } });
  hubText.anchor.set(0.5);
  hub.addChild(hubBg, hubText);
  const drawHub = (n: number | null) => {
    hubBg.clear();
    if (n === null) {
      hubBg.circle(0, 0, 58).fill({ color: 0xe8b04a });
      hubBg.circle(0, 0, 52).fill({ color: 0xc98a2e });
      hubBg.circle(0, 0, 20).fill({ color: 0xffe6a8 });
      hubBg.circle(-6, -6, 6).fill({ color: 0xffffff, alpha: 0.7 });
      hubText.text = "";
      return;
    }
    const color = POCKET_COLOR[rouletteColor(n)];
    glowCircle(hubBg, 0, 0, 62, color, 1.6, 0.12);
    hubBg.circle(0, 0, 62).fill({ color: 0xe8b04a });
    hubBg.circle(0, 0, 56).fill({ color });
    hubText.text = String(n);
  };
  drawHub(null);

  const ball = new PIXI.Container();
  const ballGlow = glowCircle(new PIXI.Graphics(), 0, 0, BALL_R, 0xffffff, 1);
  ballGlow.blendMode = "add";
  const ballBody = new PIXI.Graphics()
    .circle(0, 2, BALL_R)
    .fill({ color: 0x000000, alpha: 0.35 })
    .circle(0, 0, BALL_R)
    .fill({ color: 0xf2f2f2 })
    .circle(-2.5, -2.5, 3)
    .fill({ color: 0xffffff });
  ball.addChild(ballGlow, ballBody);
  root.addChild(rim, wheel, hub, ball, fx.layer);

  let w = 0; // wheel angle
  let phi = 0; // ball angle relative to the wheel
  let radius = R_BALL_TRACK;
  const W_SPEED = 0.0016; // rad/ms
  const B_SPEED = -0.0055; // absolute rad/ms while orbiting
  const IDLE_SPEED = 0.00012;
  let mode: "idle" | "spin" | "land" | "done" = "idle";
  let time = 0;
  let pop = 0;
  let result: number | null = null;
  let anim: ((dt: number) => void) | null = null;
  let resolveLand: (() => void) | null = null;
  let lastPocket = 0;

  const placeBall = () => {
    const p = at(radius, w + phi);
    ball.position.set(p.x, p.y);
  };
  placeBall();

  const drawHighlight = (n: number | null) => {
    highlight.clear();
    if (n === null) return;
    const i = WHEEL.indexOf(n);
    const a0 = i * SECTOR - SECTOR / 2;
    sector(highlight, R_POCKET_IN, R_POCKET_OUT, a0, a0 + SECTOR).fill({ color: 0xffffff, alpha: 0.35 });
  };

  const finish = (n: number) => {
    mode = "done";
    anim = null;
    result = n;
    drawHub(n);
    drawHighlight(n);
    pop = 1;
    const color = POCKET_COLOR[rouletteColor(n)];
    fx.ring(C, C, color === POCKET_COLOR.black ? 0xffffff : color, 120, 5);
    fx.burst(ball.x, ball.y, 0xffe6a8, 24, 4, 0.05);
    sfx.land();
    const r = resolveLand;
    resolveLand = null;
    r?.();
  };

  const tick = (t: Ticker) => {
    const dt = t.deltaMS;
    time += dt;
    if (mode === "idle" || mode === "done") {
      w += IDLE_SPEED * dt;
    } else if (mode === "spin") {
      w += W_SPEED * dt;
      phi += (B_SPEED - W_SPEED) * dt;
      radius = R_BALL_TRACK;
    }
    anim?.(dt);
    wheel.rotation = w;
    placeBall();
    ball.visible = mode !== "idle" || result !== null;
    if (pop > 0) pop = Math.max(0, pop - dt / 500);
    hub.scale.set(1 + Math.sin(pop * Math.PI) * 0.25);
    highlight.alpha = 0.6 + Math.sin(time / 150) * 0.4;
  };
  app.ticker.add(tick);

  const spin = () => {
    result = null;
    drawHub(null);
    drawHighlight(null);
    if (mode !== "spin") {
      phi = Math.PI - w; // launch the ball from the bottom of the track
      radius = R_BALL_TRACK;
    }
    mode = "spin";
  };

  return {
    spin,

    idle() {
      if (mode === "land") return;
      mode = "idle";
    },

    land(n) {
      resolveLand?.();
      return new Promise<void>((resolve) => {
        resolveLand = resolve;
        const pocket = WHEEL.indexOf(n) * SECTOR;
        if (reduced) {
          phi = pocket;
          radius = R_BALL_POCKET;
          finish(n);
          return;
        }
        if (mode !== "spin") spin();
        mode = "land";
        const D = 5_200; // wheel slows down over this long
        const DB = 3_600; // ball settles in its pocket after this long
        const w0 = w;
        const dw = (W_SPEED * D) / 3; // cubic ease-out starting at the current speed
        const phi0 = phi;
        // Relative travel ≈ current relative speed × DB / 3, snapped so it ends on the pocket.
        const rough = phi0 + ((B_SPEED - W_SPEED) * DB) / 3;
        const target = pocket + TAU * Math.ceil((rough - pocket) / TAU);
        let elapsed = 0;
        lastPocket = Math.floor(phi0 / SECTOR);
        anim = (dt) => {
          elapsed += dt;
          const k = clamp01(elapsed / D);
          w = w0 + dw * (1 - Math.pow(1 - k, 3));
          const kb = clamp01(elapsed / DB);
          phi = phi0 + (target - phi0) * (1 - Math.pow(1 - kb, 3));
          // The ball leaves the track halfway through and bounces into the pocket.
          const drop = clamp01((kb - 0.45) / 0.55);
          radius = R_BALL_TRACK - (R_BALL_TRACK - R_BALL_POCKET) * easeOutBounce(drop);
          if (drop > 0) {
            const p = Math.floor(phi / SECTOR);
            if (p !== lastPocket) {
              lastPocket = p;
              sfx.tick(2);
            }
          }
          if (k >= 1) finish(n);
        };
      });
    },

    destroy() {
      app.ticker.remove(tick);
      fx.destroy();
      const r = resolveLand;
      resolveLand = null;
      r?.();
    },
  };
}
