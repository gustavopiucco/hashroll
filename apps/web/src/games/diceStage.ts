import type { Ticker } from "pixi.js";
import { ROLL_RANGE, type Direction } from "@hashroll/fair";
import { sfx } from "@/lib/sound";
import { Fx, clamp01, easeOutBack, easeOutQuart, glowCircle } from "./fx";
import type { Stage, StageContext } from "./usePixiStage";

export const DICE_W = 640;
export const DICE_H = 340;
const PAD = 44;
const TRACK_Y = 250;
const TRACK_H = 16;
const BRAND = 0x2cf0a4;
const HOT = 0xff3d7f;

export interface DiceStage extends Stage {
  setZone(target: number, direction: Direction): void;
  /** Shuffles numbers while the house reveals the seed. */
  roll(): void;
  /** Eases to the on-chain roll; resolves when the marker has landed. */
  reveal(roll: number, win: boolean): Promise<void>;
  idle(): void;
}

const xOf = (roll: number) => PAD + (roll / ROLL_RANGE) * (DICE_W - 2 * PAD);
const fmt = (roll: number) => (roll / 100).toFixed(2);

export function createDiceStage(ctx: StageContext): DiceStage {
  const { PIXI, app, reduced } = ctx;
  const root = new PIXI.Container();
  app.stage.addChild(root);
  const fx = new Fx(ctx);

  const numberGlow = new PIXI.Graphics();
  numberGlow.blendMode = "add";
  const number = new PIXI.Text({
    text: "50.00",
    style: { fontFamily: ctx.fonts.display, fontSize: 118, fontWeight: "900", fill: 0xffffff, letterSpacing: 2 },
  });
  number.anchor.set(0.5);
  number.position.set(DICE_W / 2, 105);
  number.alpha = 0.35;

  const track = new PIXI.Graphics();
  const zone = new PIXI.Graphics();
  const ticks = new PIXI.Container();
  for (const v of [0, 25, 50, 75, 100]) {
    const t = new PIXI.Text({ text: String(v), style: { fontFamily: ctx.fonts.mono, fontSize: 13, fill: 0x8a8fc0 } });
    t.anchor.set(0.5, 0);
    t.position.set(xOf(v * 100), TRACK_Y + TRACK_H + 10);
    ticks.addChild(t);
  }

  // The marker: a glossy die that slides along the track, with a pin pointing at the roll.
  const marker = new PIXI.Container();
  const markerGlow = glowCircle(new PIXI.Graphics(), 0, -30, 24, 0xffffff, 1);
  markerGlow.blendMode = "add";
  const pin = new PIXI.Graphics().poly([-7, -6, 7, -6, 0, 6]).fill({ color: 0xffffff });
  const die = new PIXI.Container();
  die.position.set(0, -36);
  const dieBody = new PIXI.Graphics();
  die.addChild(dieBody);
  marker.addChild(markerGlow, pin, die);
  marker.position.set(xOf(5000), TRACK_Y - 8);
  marker.visible = false;

  root.addChild(numberGlow, number, track, zone, ticks, marker, fx.layer);

  const drawDie = (color: number) => {
    const s = 44;
    dieBody.clear();
    dieBody.roundRect(-s / 2, -s / 2 + 4, s, s, 11).fill({ color: 0x000000, alpha: 0.35 });
    dieBody.roundRect(-s / 2, -s / 2, s, s, 11).fill({ color });
    dieBody.roundRect(-s / 2 + 4, -s / 2 + 3, s - 8, 10, 5).fill({ color: 0xffffff, alpha: 0.35 });
    const dot = (x: number, y: number) => dieBody.circle(x, y, 4).fill({ color: 0x0c0d24 });
    dot(-10, -10);
    dot(10, 10);
    dot(0, 0);
    dot(10, -10);
    dot(-10, 10);
  };
  drawDie(0xffffff);

  let zoneState = { target: 4950, direction: "under" as Direction };
  const drawZone = () => {
    const { target, direction } = zoneState;
    const x0 = PAD;
    const x1 = DICE_W - PAD;
    const split = direction === "under" ? xOf(target) : xOf(ROLL_RANGE - target);
    track.clear();
    track.roundRect(x0 - 6, TRACK_Y - 6, x1 - x0 + 12, TRACK_H + 12, (TRACK_H + 12) / 2).fill({ color: 0x0b0c22 });
    track.roundRect(x0 - 6, TRACK_Y - 6, x1 - x0 + 12, TRACK_H + 12, (TRACK_H + 12) / 2).stroke({ width: 1, color: 0x2a2e60 });
    zone.clear();
    const [winA, winB] = direction === "under" ? [x0, split] : [split, x1];
    const [loseA, loseB] = direction === "under" ? [split, x1] : [x0, split];
    zone.roundRect(loseA, TRACK_Y, loseB - loseA, TRACK_H, TRACK_H / 2).fill({ color: HOT });
    zone.roundRect(winA, TRACK_Y, winB - winA, TRACK_H, TRACK_H / 2).fill({ color: BRAND });
    zone.rect(x0, TRACK_Y + 2, x1 - x0, 4).fill({ color: 0xffffff, alpha: 0.22 });
    zone.roundRect(split - 3, TRACK_Y - 8, 6, TRACK_H + 16, 3).fill({ color: 0xffffff });
  };
  drawZone();

  let mode: "idle" | "roll" | "reveal" | "done" = "idle";
  let time = 0;
  let shuffleAt = 0;
  let wanderTo = 5000;
  let pos = 5000;
  let pop = 0;
  let shake = 0;
  let anim: ((dt: number) => void) | null = null;
  let resolveReveal: (() => void) | null = null;

  const setNumber = (roll: number) => {
    number.text = fmt(roll);
  };
  const tint = (color: number) => {
    number.style.fill = color;
    numberGlow.clear();
    if (color !== 0xffffff) glowCircle(numberGlow, DICE_W / 2, 105, 46, color, 1.1, 0.3);
  };

  const finish = (roll: number, win: boolean) => {
    mode = "done";
    anim = null;
    pos = roll;
    marker.x = xOf(roll);
    setNumber(roll);
    const color = win ? BRAND : HOT;
    tint(color);
    drawDie(color);
    number.alpha = 1;
    pop = 1;
    if (win) {
      fx.burst(marker.x, marker.y - 36, BRAND, 40, 6);
      fx.ring(marker.x, marker.y - 36, BRAND, 80, 4);
      fx.burst(DICE_W / 2, 105, BRAND, 30, 7);
    } else {
      shake = 1;
      fx.burst(marker.x, marker.y - 36, HOT, 16, 3);
    }
    sfx.land();
    const r = resolveReveal;
    resolveReveal = null;
    r?.();
  };

  const tick = (t: Ticker) => {
    const dt = t.deltaMS;
    time += dt;
    if (mode === "roll") {
      if (time - shuffleAt > 55) {
        shuffleAt = time;
        setNumber(Math.floor(Math.random() * ROLL_RANGE));
        sfx.roll();
        if (Math.random() < 0.25) wanderTo = Math.floor(Math.random() * ROLL_RANGE);
      }
      pos += (wanderTo - pos) * Math.min(1, dt / 90);
      marker.x = xOf(pos);
      die.rotation += dt * 0.012;
      marker.y = TRACK_Y - 8 - Math.abs(Math.sin(time / 120)) * 10;
    }
    anim?.(dt);
    if (pop > 0) pop = Math.max(0, pop - dt / 450);
    number.scale.set(1 + Math.sin(pop * Math.PI) * 0.15);
    if (shake > 0) {
      shake = Math.max(0, shake - dt / 400);
      root.x = Math.sin(time / 18) * 7 * shake;
    } else root.x = 0;
    markerGlow.alpha = 0.6 + Math.sin(time / 200) * 0.25;
  };
  app.ticker.add(tick);

  return {
    setZone(target, direction) {
      zoneState = { target, direction };
      drawZone();
    },

    roll() {
      mode = "roll";
      marker.visible = true;
      number.alpha = 1;
      tint(0xffffff);
      drawDie(0xffffff);
    },

    idle() {
      if (mode === "reveal") return;
      mode = "idle";
      die.rotation = 0;
      marker.y = TRACK_Y - 8;
      number.alpha = marker.visible ? 1 : 0.35;
    },

    reveal(roll, win) {
      resolveReveal?.();
      return new Promise<void>((resolve) => {
        resolveReveal = resolve;
        marker.visible = true;
        if (reduced) {
          finish(roll, win);
          return;
        }
        mode = "reveal";
        const from = pos;
        const rot0 = die.rotation;
        const rotTo = Math.ceil(rot0 / (Math.PI / 2)) * (Math.PI / 2) + Math.PI * 2;
        const y0 = marker.y;
        const duration = 1_000;
        let elapsed = 0;
        let lastShown = -1;
        anim = (dt) => {
          elapsed += dt;
          const k = clamp01(elapsed / duration);
          const e = easeOutBack(k);
          pos = from + (roll - from) * e;
          marker.x = xOf(Math.max(0, Math.min(ROLL_RANGE, pos)));
          marker.y = y0 + (TRACK_Y - 8 - y0) * easeOutQuart(k) - Math.sin(k * Math.PI) * 26;
          die.rotation = rot0 + (rotTo - rot0) * easeOutQuart(k);
          const shown = Math.round(from + (roll - from) * easeOutQuart(k));
          if (shown !== lastShown) {
            setNumber(Math.max(0, Math.min(ROLL_RANGE - 1, shown)));
            lastShown = shown;
          }
          if (k >= 1) finish(roll, win);
        };
      });
    },

    destroy() {
      app.ticker.remove(tick);
      fx.destroy();
      const r = resolveReveal;
      resolveReveal = null;
      r?.();
    },
  };
}

