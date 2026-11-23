import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { MAX_TARGET, MIN_TARGET, ROLL_RANGE, type Direction } from "@hashroll/fair";
import { fmtRoll as fmt } from "@/lib/format";
import { sfx } from "@/lib/sound";
import { clamp01, easeOutCubic } from "./fx";
import type { ThreeStage, ThreeStageContext } from "./useThreeStage";

/*
 * The scene is a physical 0–100 number line: a lane split into a green (win) and a pink (lose) zone by a
 * gate the player drags. The die carries the rolled number on its faces and lands exactly at that number,
 * so "did it stop on green?" is the whole game. The camera never yaws, so a roll maps linearly to screen x.
 */

const LANE_L = 10;
const LANE_D = 2.4;
const LIP_Z = 1.75; // centre line of the front lip that holds the scale and the gate's handle
const HANDLE_Z = 2.2;
const DIE = 1.35;
const HOVER_Y = 1.75;
const SNAP = 50;
const BRAND = 0x2cf0a4;
const HOT = 0xff3d7f;
const WHITE = 0xffffff;
const REVEAL_MS = 1_900;

export interface DiceStage extends ThreeStage {
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

const xOf = (roll: number) => (roll / ROLL_RANGE - 0.5) * LANE_L;
const rollAt = (x: number) => (x / LANE_L + 0.5) * ROLL_RANGE;
const splitOf = (target: number, direction: Direction) => (direction === "under" ? target : ROLL_RANGE - target);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
const wrap = (angle: number) => {
  const t = Math.PI * 2;
  return ((angle % t) + t) % t;
};

/** Height of the throw at progress k: a fall followed by three decaying bounces. */
const BOUNCES = [
  { from: 0.28, to: 0.55, h: 0.95 },
  { from: 0.55, to: 0.75, h: 0.42 },
  { from: 0.75, to: 0.88, h: 0.14 },
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

/** Canvas-backed texture that only repaints when its content changes. */
class Label {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private key = "";

  constructor(private w: number, private h: number, anisotropy: number) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    this.g = canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = anisotropy;
  }

  draw(text: string, font: string, color: string, background?: string) {
    const key = `${text}|${font}|${color}|${background}`;
    if (key === this.key) return;
    this.key = key;
    const { g, w, h } = this;
    g.clearRect(0, 0, w, h);
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, w, h);
    }
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + h * 0.03, w * 0.94);
    this.texture.needsUpdate = true;
  }
}

export function createDiceStage(ctx: ThreeStageContext): DiceStage {
  const { renderer, host, reduced, fonts } = ctx;
  const canvas = renderer.domElement;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(18, 16 / 9, 0.1, 100);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.3;

  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-1.2, 10, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 5, bottom: -4, near: 1, far: 18 });
  const flash = new THREE.PointLight(WHITE, 0, 6);
  scene.add(key, flash);

  // Everything that shakes on a loss hangs from here.
  const root = new THREE.Group();
  scene.add(root);

  /* ------------------------------- Lane ------------------------------- */

  const base = new THREE.Mesh(
    new RoundedBoxGeometry(LANE_L + 1.1, 0.5, LANE_D + 1.5, 4, 0.18),
    new THREE.MeshPhysicalMaterial({ color: 0x1a1d45, roughness: 0.55, metalness: 0.2, clearcoat: 0.3, clearcoatRoughness: 0.5 }),
  );
  base.position.set(0, -0.31, 0.4);
  base.receiveShadow = true;
  root.add(base);

  // Unit-wide slab anchored at its left edge: resizing a zone is just a scale.
  const slab = new THREE.BoxGeometry(1, 0.12, LANE_D).translate(0.5, -0.06, 0);
  const zoneMesh = (color: number) => {
    const m = new THREE.Mesh(slab, new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.12, roughness: 0.6, clearcoat: 0.1 }));
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const winZone = zoneMesh(BRAND);
  const loseZone = zoneMesh(HOT);

  const flat = (w: number, h: number, material: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const textMaterial = (label: Label, opacity = 1) =>
    new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, opacity, depthWrite: false, toneMapped: false });

  const tickMaterial = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.22, depthWrite: false });
  for (let v = 10; v < 100; v += 10) flat(v === 50 ? 0.035 : 0.018, LANE_D, tickMaterial, xOf(v * 100), 0.004, 0);
  for (const v of [0, 25, 50, 75, 100]) {
    const label = new Label(128, 64, aniso);
    label.draw(String(v), `700 46px ${fonts.mono}`, "#a9aee0");
    flat(1, 0.5, textMaterial(label), xOf(v * 100), -0.05, LIP_Z - 0.05);
  }

  const zoneText = () => {
    const label = new Label(512, 128, aniso);
    return { label, mesh: flat(1, 1, textMaterial(label, 0.9), 0, 0.008, 0.55) };
  };
  const winText = zoneText();
  const loseText = zoneText();

  /* ------------------------------- Gate ------------------------------- */

  const gate = new THREE.Group();
  root.add(gate);
  const gateMaterial = new THREE.MeshStandardMaterial({ color: WHITE, emissive: 0xcfd3ff, emissiveIntensity: 0.55, roughness: 0.3 });
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.04), gateMaterial);
    m.position.set(x, y, z);
    m.castShadow = true;
    gate.add(m);
  };
  const ARCH = 2.1;
  bar(0.09, 0.05, LANE_D, 0, 0.01, 0);
  bar(0.09, ARCH, 0.09, 0, ARCH / 2, -LANE_D / 2);
  bar(0.09, 0.07, HANDLE_Z - LANE_D / 2, 0, -0.03, (HANDLE_Z + LANE_D / 2) / 2);

  const handleLabel = new Label(384, 160, aniso);
  const handleSide = new THREE.MeshPhysicalMaterial({ color: WHITE, roughness: 0.25, clearcoat: 1 });
  const handleFront = new THREE.MeshBasicMaterial({ map: handleLabel.texture, toneMapped: false });
  const handle = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.56, 0.3, 4, 0.12), [
    handleSide, handleSide, handleSide, handleSide, handleFront, handleSide,
  ]);
  // Hangs over the front edge, low enough not to hide the needle when the die lands next to the gate.
  handle.position.set(0, -0.1, HANDLE_Z);
  handle.rotation.x = -0.5;
  handle.castShadow = true;
  gate.add(handle);

  /* -------------------------------- Die ------------------------------- */

  const faceLabel = new Label(256, 256, aniso);
  const die = new THREE.Mesh(
    new RoundedBoxGeometry(DIE, DIE, DIE, 5, 0.2),
    new THREE.MeshPhysicalMaterial({ map: faceLabel.texture, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.15 }),
  );
  die.castShadow = true;
  root.add(die);

  // Needle on the scale: marks the exact number under the die's centre.
  const needle = new THREE.Mesh(
    new THREE.CircleGeometry(0.2, 3, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: WHITE, toneMapped: false }),
  );
  needle.rotation.x = -Math.PI / 2;
  needle.position.set(0, 0.02, LANE_D / 2 + 0.2);
  needle.visible = false;
  root.add(needle);

  /* ------------------------------ Effects ----------------------------- */

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1, 64),
    new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  root.add(ring);
  let ringLife = 0;
  let ringSize = 1;

  const SPARKS = 90;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparkMaterial = new THREE.PointsMaterial({ size: 0.11, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  sparks.visible = false;
  root.add(sparks);
  let sparkLife = 0;

  const shockwave = (x: number, color: number, size: number) => {
    if (reduced) return;
    ring.position.set(x, 0.02, 0);
    ring.material.color.set(color);
    ringSize = size;
    ringLife = 1;
  };
  const burst = (x: number, y: number, color: number, speed: number) => {
    if (reduced) return;
    for (let i = 0; i < SPARKS; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.9;
      const s = speed * (0.3 + Math.random() * 0.7);
      sparkPos.set([x, y, 0], i * 3);
      sparkVel.set([Math.cos(a) * s, up * speed, Math.sin(a) * s * 0.7], i * 3);
    }
    sparkMaterial.color.set(color);
    sparkLife = 1;
  };

  // The big readout is DOM: crisp at any size and free to update every frame.
  const readout = document.createElement("div");
  readout.className = "pointer-events-none absolute inset-x-0 top-0 text-center font-display text-5xl font-black leading-none tabular-nums sm:text-7xl";
  readout.setAttribute("aria-hidden", "true");
  host.appendChild(readout);

  /* ------------------------------- State ------------------------------ */

  let mode: "idle" | "roll" | "reveal" | "done" = "idle";
  let time = 0;
  let tone: Tone = "neutral";
  let faceText = "?";
  let dieScale = 1;
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

  const paintDie = () => {
    const bg = tone === "neutral" ? "#f4f5ff" : css(TONE_COLOR[tone]);
    const ink = tone === "lose" ? "#ffffff" : "#0c0d24";
    faceLabel.draw(faceText, `900 ${faceText.length > 1 ? 72 : 150}px ${fonts.display}`, ink, bg);
  };
  const paintReadout = (text: string) => {
    readout.textContent = text;
    readout.style.color = css(TONE_COLOR[tone]);
    readout.style.textShadow = tone === "neutral" ? "none" : `0 0 32px ${css(TONE_COLOR[tone])}99`;
  };
  const show = (text: string) => {
    faceText = text;
    paintDie();
    paintReadout(text === "?" ? "" : text);
  };
  const setTone = (next: Tone) => {
    tone = next;
    needle.material.color.set(TONE_COLOR[next]);
    show(faceText);
  };

  const layoutZones = () => {
    const x = xOf(shownSplit);
    const left = -LANE_L / 2;
    const right = LANE_L / 2;
    const under = direction === "under";
    const place = (mesh: THREE.Mesh, text: ReturnType<typeof zoneText>, a: number, b: number, value: string, ink: string) => {
      const w = Math.max(0.001, b - a);
      mesh.position.x = a;
      mesh.scale.x = w;
      const textW = Math.min(3, w * 0.86);
      text.mesh.visible = textW > 0.75;
      text.mesh.scale.set(textW, textW / 3, 1);
      text.mesh.position.x = (a + b) / 2;
      text.label.draw(value, `900 96px ${fonts.display}`, ink);
    };
    place(winZone, winText, under ? left : x, under ? x : right, winLabel, "#04301f");
    place(loseZone, loseText, under ? x : left, under ? right : x, "LOSE", "#4d0420");
    gate.position.x = x;
    handleLabel.draw(`‹ ${fmt(split)} ›`, `800 72px ${fonts.display}`, "#14163a", "#ffffff");
  };

  /** Half of the die's vertical extent for its current rotation, so it never sinks into the lane. */
  const rot = new THREE.Matrix4();
  const support = () => {
    const e = rot.makeRotationFromEuler(die.rotation).elements;
    return (DIE / 2) * dieScale * Math.min(1.45, Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
  };
  const hoverY = () => HOVER_Y + (dieScale - 1) * DIE;

  const finish = (roll: number, win: boolean) => {
    mode = "done";
    anim = null;
    die.rotation.set(0, 0, 0);
    die.position.set(xOf(roll), (DIE / 2) * dieScale, 0);
    needle.position.x = die.position.x;
    needle.visible = true;
    faceText = fmt(roll);
    setTone(win ? "win" : "lose");
    const color = TONE_COLOR[tone];
    pulse = reduced ? 0 : 1;
    flash.color.set(color);
    flash.position.set(die.position.x, 1.6, 2.4);
    shockwave(die.position.x, color, win ? 2.2 : 1.6);
    if (win) burst(die.position.x, DIE / 2, color, 4.2);
    else if (!reduced) shake = 1;
    sfx.land();
    const r = resolveReveal;
    resolveReveal = null;
    r?.();
  };

  /* ---------------------------- Gate dragging --------------------------- */

  const ray = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const backPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), LANE_D / 2); // where the gate's post stands
  const hit = new THREE.Vector3();
  let grabOffset = 0;
  let grabY = 0;
  let tap: { x: number; y: number } | null = null;

  /** Where the pointer touches the lane (or the gate's post above it), or null when outside. */
  const pick = (clientX: number, clientY: number): { x: number; onGate: boolean; onLane: boolean } | null => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2), camera);
    if (ray.ray.intersectPlane(floorPlane, hit) && hit.z > -LANE_D / 2 && hit.z < HANDLE_Z + 0.9) {
      const near = Math.abs(hit.x - gate.position.x);
      return { x: hit.x, onGate: near < (hit.z > LANE_D / 2 ? 0.9 : 0.35), onLane: Math.abs(hit.x) < LANE_L / 2 + 0.3 };
    }
    if (ray.ray.intersectPlane(backPlane, hit) && hit.y > 0 && hit.y < ARCH) {
      return { x: hit.x, onGate: Math.abs(hit.x - gate.position.x) < 0.3, onLane: false };
    }
    return null;
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
    if (!p) return;
    if (p.onGate) {
      dragging = true;
      canvas.style.cursor = "grabbing";
      grabY = e.clientY;
      grabOffset = p.x - gate.position.x;
      canvas.setPointerCapture(e.pointerId);
    } else if (p.onLane) {
      tap = { x: e.clientX, y: e.clientY };
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    if (dragging && !locked) {
      // Horizontal only: follow the pointer along the line it grabbed, wherever it drifts vertically.
      const p = pick(e.clientX, grabY);
      if (p) moveTo(p.x - grabOffset);
      return;
    }
    const p = locked ? null : pick(e.clientX, e.clientY);
    hover = !!p?.onGate;
    canvas.style.cursor = p?.onGate ? "grab" : p?.onLane ? "pointer" : "";
  };
  const onUp = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    // A tap (not a scroll that started on the lane) sends the gate there.
    if (tap && !locked && e.type === "pointerup" && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 8) {
      const p = pick(e.clientX, e.clientY);
      if (p?.onLane) moveTo(p.x);
    }
    tap = null;
    dragging = false;
    canvas.style.cursor = "";
  };
  const onLeave = () => {
    hover = false;
  };
  canvas.style.touchAction = "pan-y";
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);

  /* ------------------------------- Frame ------------------------------ */

  const frame = (dt: number) => {
    time += dt;
    const ease = (ms: number) => (reduced ? 1 : 1 - Math.exp(-dt / ms));

    if (shownSplit !== split) {
      shownSplit += (split - shownSplit) * (dragging ? 1 : ease(70));
      if (Math.abs(shownSplit - split) < 1) shownSplit = split;
      layoutZones();
    }

    if (mode === "idle") {
      const k = ease(160);
      die.position.x += (0 - die.position.x) * k;
      die.position.y += (hoverY() + (reduced ? 0 : Math.sin(time / 700) * 0.1) - die.position.y) * k;
      if (reduced) die.rotation.set(0, 0, 0);
      else die.rotation.set(0.15, Math.sin(time / 1400) * 0.5, 0);
    } else if (mode === "roll") {
      const k = ease(140);
      const wander = reduced ? 0 : Math.sin(time / 520) * 2.6;
      die.position.x += (wander - die.position.x) * k;
      die.position.y += (hoverY() + (reduced ? 0 : Math.sin(time / 210) * 0.2) - die.position.y) * k;
      if (!reduced) {
        die.rotation.x += dt * 0.009;
        die.rotation.y += dt * 0.006;
        die.rotation.z += dt * 0.0075;
        if (time - shuffleAt > 70) {
          shuffleAt = time;
          show(fmt(Math.floor(Math.random() * ROLL_RANGE)));
          sfx.roll();
        }
      }
    }
    anim?.(dt);

    pulse = Math.max(0, pulse - dt / 1400);
    const beat = pulse * (0.5 + 0.5 * Math.sin(time / 70));
    winZone.material.emissiveIntensity = 0.12 + (tone === "win" ? beat * 0.7 : 0);
    loseZone.material.emissiveIntensity = 0.12 + (tone === "lose" ? beat * 0.6 : 0);
    flash.intensity = pulse * 9;

    // Until the player has moved the gate once, the handle wiggles to say "drag me".
    const hint = !touched && !locked && !reduced && mode !== "reveal" ? Math.max(0, Math.sin(time / 900)) ** 12 : 0;
    handle.position.x = Math.sin(time / 60) * 0.09 * hint;
    const grow = dragging || hover || focused ? 1.12 : 1;
    handle.scale.setScalar(handle.scale.x + (grow * dieScale ** 1.2 - handle.scale.x) * ease(60));
    handleSide.color.set(focused ? 0x4cc9ff : WHITE);
    gateMaterial.emissiveIntensity = dragging || hover || focused ? 1 : 0.55;

    if (ringLife > 0) {
      ringLife = Math.max(0, ringLife - dt / 520);
      ring.scale.setScalar(0.4 + easeOutCubic(1 - ringLife) * ringSize);
      ring.material.opacity = ringLife;
    }
    ring.visible = ringLife > 0;

    if (sparkLife > 0) {
      sparkLife = Math.max(0, sparkLife - dt / 1100);
      const s = dt / 1000;
      for (let i = 0; i < SPARKS * 3; i += 3) {
        sparkVel[i + 1] -= 9 * s;
        for (let c = 0; c < 3; c++) sparkPos[i + c] += sparkVel[i + c] * s;
      }
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkMaterial.opacity = sparkLife;
    }
    sparks.visible = sparkLife > 0;

    shake = Math.max(0, shake - dt / 420);
    root.position.x = shake > 0 ? Math.sin(time / 18) * 0.12 * shake : 0;

    renderer.render(scene, camera);
  };

  show("?");
  layoutZones();
  die.position.set(0, HOVER_Y, 0);

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
        const x0 = die.position.x;
        const x1 = xOf(roll);
        const lift = Math.max(0, die.position.y - support());
        // Angles unwind to zero, so the die always stops with its number upright. Rolling right spins clockwise.
        const turns = Math.PI * 2;
        const ax = wrap(die.rotation.x) + turns;
        const ay = wrap(die.rotation.y);
        const az = wrap(die.rotation.z) + (x1 >= x0 ? turns : -2 * turns);
        let elapsed = 0;
        let impacts = 0;
        let shownAt = -Infinity;
        anim = (dt) => {
          elapsed += dt;
          const k = clamp01(elapsed / REVEAL_MS);
          const e = easeOutCubic(k);
          const left = 1 - e;
          die.rotation.set(ax * left, ay * left, az * left);
          die.position.x = x0 + (x1 - x0) * e;
          die.position.y = support() + throwHeight(k, lift);
          needle.position.x = die.position.x;
          if (impacts < BOUNCES.length && k >= BOUNCES[impacts].from) {
            shockwave(die.position.x, WHITE, 1.6 - impacts * 0.4);
            sfx.tick(6 - impacts * 2);
            impacts++;
          }
          // The number is the die's live position on the lane, so it settles exactly on the roll.
          if (elapsed - shownAt > 45) {
            shownAt = elapsed;
            show(fmt(clamp(Math.round(rollAt(die.position.x)), 0, ROLL_RANGE - 1)));
          }
          if (k >= 1) finish(roll, win);
        };
      });
    },

    resize(width, height) {
      // Narrow screens shrink the whole lane, so enlarge the die to keep its number readable.
      dieScale = width < 480 ? 1.35 : 1;
      die.scale.setScalar(dieScale);
      if (mode === "done") die.position.y = (DIE / 2) * dieScale;

      // Fit the front edge of the base to the width...
      const pitch = THREE.MathUtils.degToRad(width < 480 ? 46 : 33);
      const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const front = { x: LANE_L / 2 + 0.8, y: -0.56, z: 2.4 };
      const distance = front.x / (0.97 * tan * (width / height)) + front.z * Math.cos(pitch) + front.y * Math.sin(pitch);
      camera.aspect = width / height;
      camera.position.set(0, Math.sin(pitch) * distance, Math.cos(pitch) * distance);
      camera.lookAt(0, 0, 0);
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      // ...then shift the lens (no extra perspective) so that edge rests at the bottom of the canvas.
      const edge = new THREE.Vector3(0, front.y, front.z).project(camera).y;
      camera.setViewOffset(width, height, 0, (-0.96 - edge) * (height / 2), width, height);
      camera.updateMatrixWorld();
    },

    frame,

    destroy() {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      readout.remove();
      scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof THREE.Points)) return;
        o.geometry.dispose();
        for (const m of [o.material].flat() as (THREE.Material & { map?: THREE.Texture | null })[]) {
          m.map?.dispose();
          m.dispose();
        }
      });
      key.dispose();
      environment.dispose();
      const r = resolveReveal;
      resolveReveal = null;
      r?.();
    },
  };
  return stage;
}
