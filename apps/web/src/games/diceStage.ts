import type { Sprite, Ticker } from "pixi.js";
import { MAX_TARGET, MIN_TARGET, ROLL_RANGE, type Direction } from "@hashroll/fair";
import { fmtRoll as fmt } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { Fx, clamp01, easeOutCubic, glowCircle, mixColor } from "./fx";
import type { Stage, StageContext } from "./usePixiStage";

/*
 * The scene is a physical 0–100 number line drawn in 2.5D: a lane split into a green (win) and a pink (lose)
 * zone by a gate the player drags. The die carries the rolled number on its faces and lands exactly at that
 * number, so "did it stop on green?" is the whole game.
 *
 * Everything is seen through an orthographic camera pitched down by PITCH with no yaw, so a roll maps
 * linearly to screen x at any depth. The lane and the gate are plain 2D shapes laid out for that view; the
 * die is a real cube whose faces are projected one by one.
 */

/** Logical scene size. Narrow screens get a smaller scene so the die and the handle stay readable. */
export const diceSize = (narrow: boolean) => (narrow ? { width: 520, height: 420 } : { width: 820, height: 440 });

const PITCH = Math.PI / 6;
const COS = Math.cos(PITCH);
const SIN = Math.sin(PITCH);
const PAD = 44;
const LANE_D = 110; // on-screen depth of the lane's top face
const FRONT = 18; // on-screen height of the lane's front side
const ARCH = 118;
const DIE = 84;
const HOVER = 108; // height of the die's centre while it floats
const TEX = 256;
const SNAP = 50;
const BRAND = 0x2cf0a4;
const HOT = 0xff3d7f;
const WHITE = 0xffffff;
const FOCUS = 0x4cc9ff;
const REVEAL_MS = 1_900;

export interface DiceStage extends Stage {
  /** Called while the player drags the gate (or taps the lane) with the new number of winning outcomes. */
  onTarget: ((target: number) => void) | null;
  setZone(target: number, direction: Direction, winLabel: string): void;
  /** Ignores gate dragging while a bet is in flight. */
  setLocked(locked: boolean): void;
  /** Highlights the handle while the keyboard slider has focus. */
  setFocused(focused: boolean): void;
  /** Tumbles the die in the air while the house reveals the seed. */
  roll(): void;
  /** Throws the die onto the on-chain roll; resolves when it has come to rest. */
  reveal(roll: number, win: boolean): Promise<void>;
  idle(): void;
}

type Tone = "neutral" | "win" | "lose";
const TONE_COLOR: Record<Tone, number> = { neutral: WHITE, win: BRAND, lose: HOT };

const splitOf = (target: number, direction: Direction) => (direction === "under" ? target : ROLL_RANGE - target);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const wrap = (angle: number) => {
  const t = Math.PI * 2;
  return ((angle % t) + t) % t;
};

/** Height of the throw at progress k: a fall followed by three decaying bounces. */
const BOUNCES = [
  { from: 0.28, to: 0.55, h: 59 },
  { from: 0.55, to: 0.75, h: 26 },
  { from: 0.75, to: 0.88, h: 9 },
];
function throwHeight(k: number, start: number) {
  const fall = BOUNCES[0].from;
  if (k < fall) {
    const t = k / fall;
    return start * (1 - t * t);
  }
  for (const b of BOUNCES) {
    if (k < b.to) {
      const t = (k - b.from) / (b.to - b.from);
      return b.h * 4 * t * (1 - t);
    }
  }
  return 0;
}

/*
 * Cube faces in die space (x right, y up, z towards the viewer). Each face names the axis and sign of its
 * outward normal, of its texture's right and of its texture's down, so every number reads upright from outside.
 */
const FACES: readonly (readonly [number, number, number, number, number, number])[] = [
  [2, 1, 0, 1, 1, -1], // front
  [2, -1, 0, -1, 1, -1], // back
  [0, 1, 2, -1, 1, -1], // right
  [0, -1, 2, 1, 1, -1], // left
  [1, 1, 0, 1, 2, 1], // top
  [1, -1, 0, 1, 2, -1], // bottom
];
const LIGHT = [-0.25, 0.75, 0.61];

export function createDiceStage(ctx: StageContext): DiceStage {
  const { PIXI, app, reduced, fonts, width: W, height: H } = ctx;
  const canvas = app.canvas;

  const laneL = W - 2 * PAD;
  const x0 = PAD;
  const x1 = W - PAD;
  const laneMid = H - 155;
  const laneT = laneMid - LANE_D / 2;
  const laneB = laneMid + LANE_D / 2;
  const handleY = laneB + FRONT + 48;
  const xOf = (roll: number) => x0 + (roll / ROLL_RANGE) * laneL;
  const rollAt = (x: number) => ((x - x0) / laneL) * ROLL_RANGE;

  // Everything that shakes on a loss hangs from here.
  const root = new PIXI.Container();
  app.stage.addChild(root);
  const fx = new Fx(ctx);

  /* ------------------------------- Lane ------------------------------- */

  const base = new PIXI.Graphics()
    .roundRect(x0 - 16, laneT - 12, laneL + 32, LANE_D + 24 + FRONT + 34, 16)
    .fill({ color: 0x101233 })
    .roundRect(x0 - 16, laneT - 12, laneL + 32, LANE_D + 24, 16)
    .fill({ color: 0x1a1d45 });
  root.addChild(base);

  const zoneText = (ink: number) => {
    const t = new PIXI.Text({ text: "", style: { fontFamily: fonts.display, fontSize: 38, fontWeight: "900", fill: ink } });
    t.anchor.set(0.5);
    t.y = laneMid + 28;
    t.alpha = 0.9;
    return t;
  };
  // White sprites tinted and stretched: resizing a zone is just a width.
  const zone = (color: number, ink: number) => {
    const top = new PIXI.Sprite(PIXI.Texture.WHITE);
    top.tint = color;
    top.y = laneT;
    top.height = LANE_D;
    const side = new PIXI.Sprite(PIXI.Texture.WHITE);
    side.tint = mixColor(color, 0x000000, 0.45);
    side.y = laneB;
    side.height = FRONT;
    root.addChild(top, side);
    return { top, side, text: zoneText(ink) };
  };
  const winZone = zone(BRAND, 0x04301f);
  const loseZone = zone(HOT, 0x4d0420);

  // Brightens the zone the die landed on.
  const zoneGlow = new PIXI.Sprite(PIXI.Texture.WHITE);
  zoneGlow.blendMode = "add";
  zoneGlow.y = laneT;
  zoneGlow.height = LANE_D;
  zoneGlow.alpha = 0;

  const ticks = new PIXI.Graphics();
  for (let v = 10; v < 100; v += 10) {
    const w = v === 50 ? 3 : 1.5;
    ticks.rect(xOf(v * 100) - w / 2, laneT, w, LANE_D).fill({ color: WHITE, alpha: 0.22 });
  }
  root.addChild(zoneGlow, ticks, winZone.text, loseZone.text);

  for (const v of [0, 25, 50, 75, 100]) {
    const t = new PIXI.Text({ text: String(v), style: { fontFamily: fonts.mono, fontSize: 13, fontWeight: "700", fill: 0xa9aee0 } });
    t.anchor.set(0.5, 0);
    t.position.set(xOf(v * 100), laneB + FRONT + 7);
    root.addChild(t);
  }

  /* ------------------------------- Gate ------------------------------- */

  // The line on the lane and the post at its far edge sit behind the die; the handle sits in front.
  const gateBack = new PIXI.Graphics()
    .rect(-2.5, laneT, 5, LANE_D)
    .roundRect(-4.5, laneT - ARCH, 9, ARCH + 4, 4.5)
    .fill({ color: WHITE });
  const gateFront = new PIXI.Container();
  gateFront.addChild(new PIXI.Graphics().rect(-2.5, laneB, 5, handleY - laneB).fill({ color: WHITE }));

  const HANDLE_W = 128;
  const handle = new PIXI.Container();
  handle.y = handleY;
  const handleRing = new PIXI.Graphics().roundRect(-HANDLE_W / 2 - 4, -24, HANDLE_W + 8, 48, 18).stroke({ width: 3, color: FOCUS });
  handleRing.visible = false;
  const handleText = new PIXI.Text({ text: "", style: { fontFamily: fonts.display, fontSize: 22, fontWeight: "800", fill: 0x14163a } });
  handleText.anchor.set(0.5);
  handle.addChild(
    new PIXI.Graphics()
      .roundRect(-HANDLE_W / 2, -15, HANDLE_W, 40, 14)
      .fill({ color: 0x000000, alpha: 0.4 })
      .roundRect(-HANDLE_W / 2, -20, HANDLE_W, 40, 14)
      .fill({ color: WHITE }),
    handleRing,
    handleText,
  );
  gateFront.addChild(handle);

  /* -------------------------------- Die ------------------------------- */

  // A few stacked translucent shapes fake a soft edge (cheaper than a blur filter).
  const shadow = new PIXI.Graphics();
  for (let i = 0; i < 4; i++) {
    const grow = i * 4;
    shadow.roundRect(-DIE / 2 - grow, (-DIE * SIN) / 2 - grow, DIE + grow * 2, DIE * SIN + grow * 2, 10 + grow).fill({ color: 0x000000, alpha: 0.17 });
  }
  shadow.y = laneMid;

  const dieGlow = glowCircle(new PIXI.Graphics(), 0, 0, DIE * 0.62, WHITE, 1.6);
  dieGlow.blendMode = "add";
  dieGlow.alpha = 0;

  // One canvas holds the face artwork; all six faces share it, so a new number is a single repaint.
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = faceCanvas.height = TEX;
  const faceG = faceCanvas.getContext("2d")!;
  const faceTexture = PIXI.Texture.from(faceCanvas);
  const die = new PIXI.Container();
  const faces: Sprite[] = FACES.map(() => {
    const s = new PIXI.Sprite(faceTexture);
    s.anchor.set(0.5);
    die.addChild(s);
    return s;
  });

  // Needle on the lane's front edge: marks the exact number under the die's centre.
  const needle = new PIXI.Graphics().poly([-9, 15, 9, 15, 0, 1]).fill({ color: WHITE });
  needle.y = laneB;
  needle.visible = false;

  const ring = new PIXI.Graphics().ellipse(0, 0, 60, 60 * SIN).stroke({ width: 3, color: WHITE });
  ring.blendMode = "add";
  ring.y = laneMid;
  ring.visible = false;
  let ringLife = 0;
  let ringSize = 1;

  const readout = new PIXI.Text({
    text: "",
    style: { fontFamily: fonts.display, fontSize: W < 600 ? 50 : 62, fontWeight: "900", fill: WHITE, letterSpacing: 1 },
  });
  readout.anchor.set(0.5);
  readout.position.set(W / 2, 46);

  root.addChild(gateBack, shadow, ring, dieGlow, die, needle, gateFront, fx.layer, readout);

  /* ------------------------------- State ------------------------------ */

  let mode: "idle" | "roll" | "reveal" | "done" = "idle";
  let time = 0;
  let tone: Tone = "neutral";
  let faceText = "?";
  let shuffleAt = 0;
  let shake = 0;
  let pulse = 0;
  let locked = false;
  let focused = false;
  let dragging = false;
  let hover = false;
  let touched = false;
  let split = 4950;
  let shownSplit = split;
  let direction: Direction = "under";
  let winLabel = "";
  let anim: ((dt: number) => void) | null = null;
  let resolveReveal: (() => void) | null = null;

  /** Die pose: x along the lane in scene pixels, y the height of its centre above the lane, Euler angles. */
  const pos = { x: W / 2, y: HOVER };
  const rot = { x: 0, y: 0, z: 0 };
  /** Rotation matrix for `rot` (row-major, XYZ order). */
  const m = new Float64Array(9);
  const matrix = new PIXI.Matrix();

  const shockwave = (x: number, color: number, size: number) => {
    if (reduced) return;
    ring.x = x;
    ring.tint = color;
    ringSize = size;
    ringLife = 1;
  };

  let painted = "";
  const paintDie = () => {
    const bg = tone === "neutral" ? "#f4f5ff" : css(TONE_COLOR[tone]);
    const ink = tone === "lose" ? "#ffffff" : "#0c0d24";
    const key = `${faceText}|${bg}`;
    if (key === painted) return;
    painted = key;
    const g = faceG;
    g.clearRect(0, 0, TEX, TEX);
    g.beginPath();
    g.roundRect(0, 0, TEX, TEX, 22);
    g.fillStyle = bg;
    g.fill();
    g.beginPath();
    g.roundRect(5, 5, TEX - 10, TEX - 10, 18);
    g.lineWidth = 10;
    // Coloured faces get a heavier rim, or a winning die would melt into the green zone it sits on.
    g.strokeStyle = `rgba(12, 13, 36, ${tone === "neutral" ? 0.14 : 0.32})`;
    g.stroke();
    g.font = `900 ${faceText.length > 1 ? 78 : 150}px ${fonts.display}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = ink;
    g.fillText(faceText, TEX / 2, TEX / 2 + TEX * 0.03, TEX * 0.86);
    faceTexture.source.update();
  };
  const show = (text: string) => {
    faceText = text;
    paintDie();
    readout.text = text === "?" ? "" : text;
  };
  const setTone = (next: Tone) => {
    tone = next;
    const color = TONE_COLOR[next];
    needle.tint = color;
    dieGlow.tint = color;
    zoneGlow.tint = color;
    readout.style.fill = color;
    show(faceText);
  };

  /** Projects the cube: hides the faces that point away and skews each visible one into place. */
  const poseDie = () => {
    const a = Math.cos(rot.x), b = Math.sin(rot.x);
    const c = Math.cos(rot.y), d = Math.sin(rot.y);
    const e = Math.cos(rot.z), f = Math.sin(rot.z);
    m[0] = c * e;             m[1] = -c * f;            m[2] = d;
    m[3] = a * f + b * e * d; m[4] = a * e - b * f * d; m[5] = -b * c;
    m[6] = b * f - a * e * d; m[7] = b * e + a * f * d; m[8] = a * c;

    const k = DIE / TEX;
    for (let i = 0; i < FACES.length; i++) {
      const [nAxis, nSign, uAxis, uSign, dAxis, dSign] = FACES[i];
      const nx = m[nAxis] * nSign, ny = m[3 + nAxis] * nSign, nz = m[6 + nAxis] * nSign;
      const sprite = faces[i];
      // The viewer sits along (0, SIN, COS).
      sprite.visible = ny * SIN + nz * COS > 0.02;
      if (!sprite.visible) continue;
      const ux = m[uAxis] * uSign, uy = m[3 + uAxis] * uSign, uz = m[6 + uAxis] * uSign;
      const dx = m[dAxis] * dSign, dy = m[3 + dAxis] * dSign, dz = m[6 + dAxis] * dSign;
      matrix.set(
        ux * k, (uz * SIN - uy * COS) * k,
        dx * k, (dz * SIN - dy * COS) * k,
        (nx * DIE) / 2, ((nz * SIN - ny * COS) * DIE) / 2,
      );
      sprite.setFromMatrix(matrix);
      const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      const shade = Math.round(255 * (0.6 + 0.4 * lit));
      sprite.tint = (shade << 16) | (shade << 8) | shade;
    }

    die.position.set(pos.x, laneMid - pos.y * COS);
    dieGlow.position.copyFrom(die.position);
    const lift = Math.max(0, pos.y - DIE / 2);
    // The light comes from the left, so the shadow slides right as the die rises.
    shadow.x = pos.x + 7 + lift * 0.12;
    shadow.scale.set(1 + lift / 260);
    shadow.alpha = Math.max(0.15, 1 - lift / 190);
  };
  /** Half of the die's vertical extent for its current rotation, so it never sinks into the lane. */
  const support = () => {
    poseDie();
    return (DIE / 2) * Math.min(1.45, Math.abs(m[3]) + Math.abs(m[4]) + Math.abs(m[5]));
  };

  const placeHandle = (wiggle = 0) => {
    // Near the ends of the lane the handle stays inside the canvas while the gate keeps moving.
    const half = HANDLE_W / 2 + 6;
    handle.x = clamp(gateFront.x, half, W - half) - gateFront.x + wiggle;
  };
  const layoutZones = () => {
    const x = xOf(shownSplit);
    const under = direction === "under";
    const place = (z: ReturnType<typeof zone>, a: number, b: number, value: string) => {
      const w = Math.max(0.001, b - a);
      z.top.x = z.side.x = a;
      z.top.width = z.side.width = w;
      if (z.text.text !== value) z.text.text = value;
      z.text.visible = w > 70 && value !== "";
      if (!z.text.visible) return;
      z.text.scale.set(1);
      const s = Math.min(1, (w * 0.86) / z.text.width);
      // Squashed vertically so the label lies on the lane.
      z.text.scale.set(s, s * 0.6);
      z.text.x = (a + b) / 2;
    };
    place(winZone, under ? x0 : x, under ? x : x1, winLabel);
    place(loseZone, under ? x : x0, under ? x1 : x, "LOSE");
    gateBack.x = gateFront.x = x;
    placeHandle();
    handleText.text = `‹ ${fmt(split)} ›`;
  };

  const finish = (roll: number, win: boolean) => {
    mode = "done";
    anim = null;
    rot.x = rot.y = rot.z = 0;
    pos.x = xOf(roll);
    pos.y = DIE / 2;
    needle.x = pos.x;
    needle.visible = true;
    faceText = fmt(roll);
    setTone(win ? "win" : "lose");
    const color = TONE_COLOR[tone];
    pulse = reduced ? 0 : 1;
    shockwave(pos.x, color, win ? 2.2 : 1.6);
    if (win) fx.burst(pos.x, laneMid - DIE / 2, color, 60, 6);
    else if (!reduced) shake = 1;
    sfx.land();
    const r = resolveReveal;
    resolveReveal = null;
    r?.();
  };

  /* ---------------------------- Gate dragging --------------------------- */

  let grabOffset = 0;
  let tap: { x: number; y: number } | null = null;

  /** Where the pointer is in scene pixels, and whether it is over the gate or the lane. */
  const pick = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    const y = ((clientY - r.top) / r.height) * H;
    const lip = laneB + FRONT + 18;
    const onHandle = y > lip && Math.abs(x - gateFront.x - handle.x) < HANDLE_W / 2 + 14;
    const onPost = y > laneT - ARCH && y <= lip && Math.abs(x - gateFront.x) < 20;
    return { x, onGate: onHandle || onPost, onLane: y >= laneT && y <= laneB + FRONT && x > x0 - 12 && x < x1 + 12 };
  };
  const moveTo = (x: number) => {
    const raw = rollAt(x);
    const target = clamp(Math.round((direction === "under" ? raw : ROLL_RANGE - raw) / SNAP) * SNAP, MIN_TARGET, MAX_TARGET);
    if (splitOf(target, direction) === split) return;
    touched = true;
    sfx.tick(target / 800);
    stage.onTarget?.(target);
  };
  const onDown = (e: PointerEvent) => {
    if (locked || !e.isPrimary || e.button !== 0) return;
    const p = pick(e.clientX, e.clientY);
    if (p.onGate) {
      dragging = true;
      canvas.style.cursor = "grabbing";
      grabOffset = p.x - gateFront.x;
      canvas.setPointerCapture(e.pointerId);
    } else if (p.onLane) {
      tap = { x: e.clientX, y: e.clientY };
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    const p = pick(e.clientX, e.clientY);
    if (dragging && !locked) {
      moveTo(p.x - grabOffset);
      return;
    }
    hover = !locked && p.onGate;
    canvas.style.cursor = locked ? "" : p.onGate ? "grab" : p.onLane ? "pointer" : "";
  };
  const onUp = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    // A tap (not a scroll that started on the lane) sends the gate there.
    if (tap && !locked && e.type === "pointerup" && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) {
      const p = pick(e.clientX, e.clientY);
      if (p.onLane) moveTo(p.x);
    }
    tap = null;
    dragging = false;
    canvas.style.cursor = "";
  };
  const onLeave = () => {
    hover = false;
  };
  // Pixi's event system disables touch gestures on its canvas; the page must still scroll over the lane.
  canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  /* ------------------------------- Frame ------------------------------ */

  const tick = (t: Ticker) => {
    // Capped so a throttled tab does not skip a whole animation.
    const dt = Math.min(50, t.deltaMS);
    time += dt;
    const ease = (ms: number) => (reduced ? 1 : 1 - Math.exp(-dt / ms));

    if (shownSplit !== split) {
      shownSplit += (split - shownSplit) * (dragging ? 1 : ease(70));
      if (Math.abs(shownSplit - split) < 1) shownSplit = split;
      layoutZones();
    }

    if (mode === "idle") {
      const k = ease(160);
      pos.x += (W / 2 - pos.x) * k;
      pos.y += (HOVER + (reduced ? 0 : Math.sin(time / 700) * 6) - pos.y) * k;
      rot.x = reduced ? 0 : 0.15;
      rot.y = reduced ? 0 : Math.sin(time / 1400) * 0.5;
      rot.z = 0;
    } else if (mode === "roll") {
      const k = ease(140);
      const wander = reduced ? 0 : Math.sin(time / 520) * laneL * 0.26;
      pos.x += (W / 2 + wander - pos.x) * k;
      pos.y += (HOVER + (reduced ? 0 : Math.sin(time / 210) * 12) - pos.y) * k;
      if (!reduced) {
        rot.x += dt * 0.009;
        rot.y += dt * 0.006;
        rot.z += dt * 0.0075;
        if (time - shuffleAt > 70) {
          shuffleAt = time;
          show(fmt(Math.floor(Math.random() * ROLL_RANGE)));
          sfx.roll();
        }
      }
    }
    anim?.(dt);
    poseDie();

    pulse = Math.max(0, pulse - dt / 1400);
    const beat = pulse * (0.5 + 0.5 * Math.sin(time / 70));
    if (tone === "neutral" || pulse === 0) {
      zoneGlow.alpha = 0;
    } else {
      const lit = tone === "win" ? winZone.top : loseZone.top;
      zoneGlow.x = lit.x;
      zoneGlow.width = lit.width;
      zoneGlow.alpha = beat * 0.3;
    }
    dieGlow.alpha = pulse;

    // Until the player has moved the gate once, the handle wiggles to say "drag me".
    const hint = !touched && !locked && !reduced && mode !== "reveal" ? Math.max(0, Math.sin(time / 900)) ** 12 : 0;
    placeHandle(Math.sin(time / 60) * 6 * hint);
    const active = dragging || hover || focused;
    handle.scale.set(handle.scale.x + ((active ? 1.12 : 1) - handle.scale.x) * ease(60));
    handleRing.visible = focused;
    gateBack.alpha = active ? 1 : 0.8;

    if (ringLife > 0) {
      ringLife = Math.max(0, ringLife - dt / 520);
      ring.scale.set(0.4 + easeOutCubic(1 - ringLife) * ringSize);
      ring.alpha = ringLife;
    }
    ring.visible = ringLife > 0;

    shake = Math.max(0, shake - dt / 420);
    root.x = shake > 0 ? Math.sin(time / 18) * 7 * shake : 0;
  };

  show("?");
  layoutZones();
  poseDie();
  app.ticker.add(tick);

  const stage: DiceStage = {
    onTarget: null,

    setZone(target, dir, label) {
      const next = splitOf(target, dir);
      const changed = next !== split || dir !== direction;
      split = next;
      direction = dir;
      winLabel = label;
      // The old result says nothing about the new zones: stop painting it as a win or a loss.
      if (changed && mode === "done" && tone !== "neutral") {
        pulse = 0;
        setTone("neutral");
      }
      layoutZones();
    },

    setLocked(value) {
      locked = value;
      if (locked) {
        dragging = hover = false;
        tap = null;
        canvas.style.cursor = "";
      }
    },

    setFocused(value) {
      focused = value;
    },

    roll() {
      mode = "roll";
      needle.visible = false;
      pulse = 0;
      faceText = "?";
      setTone("neutral");
    },

    idle() {
      if (mode === "reveal" || mode === "done") return;
      mode = "idle";
      needle.visible = false;
      faceText = "?";
      setTone("neutral");
    },

    reveal(roll, win) {
      resolveReveal?.();
      return new Promise<void>((resolve) => {
        resolveReveal = resolve;
        if (reduced) {
          finish(roll, win);
          return;
        }
        mode = "reveal";
        setTone("neutral");
        needle.visible = true;
        const from = pos.x;
        const to = xOf(roll);
        const lift = Math.max(0, pos.y - support());
        // Angles unwind to zero, so the die always stops with its number upright. Rolling right spins clockwise.
        const turns = Math.PI * 2;
        const ax = wrap(rot.x) + turns;
        const ay = wrap(rot.y);
        const az = wrap(rot.z) + (to >= from ? turns : -2 * turns);
        let elapsed = 0;
        let impacts = 0;
        let shownAt = -Infinity;
        anim = (dt) => {
          elapsed += dt;
          const k = clamp01(elapsed / REVEAL_MS);
          const e = easeOutCubic(k);
          const left = 1 - e;
          rot.x = ax * left;
          rot.y = ay * left;
          rot.z = az * left;
          pos.x = from + (to - from) * e;
          pos.y = support() + throwHeight(k, lift);
          needle.x = pos.x;
          if (impacts < BOUNCES.length && k >= BOUNCES[impacts].from) {
            shockwave(pos.x, WHITE, 1.6 - impacts * 0.4);
            sfx.tick(6 - impacts * 2);
            impacts++;
          }
          // The number is the die's live position on the lane, so it settles exactly on the roll.
          if (elapsed - shownAt > 45) {
            shownAt = elapsed;
            show(fmt(clamp(Math.round(rollAt(pos.x)), 0, ROLL_RANGE - 1)));
          }
          if (k >= 1) finish(roll, win);
        };
      });
    },

    destroy() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      app.ticker.remove(tick);
      fx.destroy();
      faceTexture.destroy(true);
      const r = resolveReveal;
      resolveReveal = null;
      r?.();
    },
  };
  return stage;
}
