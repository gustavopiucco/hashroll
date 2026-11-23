import type { Container, Graphics, GraphicsContext, Ticker } from "pixi.js";
import { SLOT_LINES, SLOT_SYMBOLS, slotWins } from "@hashroll/fair";
import { sfx } from "@/lib/sound";
import { Fx, easeOutCubic, glowCircle } from "./fx";
import { slotColor, slotSvg } from "./slotSymbols";
import type { Stage, StageContext } from "./usePixiStage";

export const SLOTS_W = 600;
export const SLOTS_H = 580;
const CELL = 160;
const GAP = 14;
const COLS = 3;
const ROWS = 3;
const GRID_W = COLS * CELL + (COLS - 1) * GAP;
const GRID_H = ROWS * CELL;
const X0 = (SLOTS_W - GRID_W) / 2;
const Y0 = (SLOTS_H - GRID_H) / 2;
const ICON_SCALE = 1.75;
/** Scroll speed while spinning, in cells per ms. */
const SPEED = 0.018;
const LINE_MS = 260;

const colX = (c: number) => X0 + c * (CELL + GAP) + CELL / 2;
const rowY = (r: number) => Y0 + r * CELL + CELL / 2;
const cellPos = (i: number) => ({ x: colX(i % COLS), y: rowY(Math.floor(i / COLS)) });

/**
 * A column scrolling down an endless strip. Strip index `k` sits at row `pos - k`, so when `pos` is
 * an integer the rows 0..2 show the indexes pos, pos - 1 and pos - 2.
 */
interface Reel {
  pos: number;
  strip: Map<number, number>;
  cells: { g: Graphics; row: number }[];
  stop: { from: number; to: number; elapsed: number; duration: number } | null;
  spinning: boolean;
}

export interface SlotsStage extends Stage {
  /** Reels spin while the house reveals the seed. */
  spin(): void;
  /** Stops the reels on the on-chain grid and shows the winning lines; resolves when done. */
  land(grid: number[]): Promise<void>;
  /** Stops without a result (the bet failed): settles on a board with no line. */
  idle(): void;
}

/** Decorative symbol for the parts of the strip that only scroll past. */
const randomSymbol = () => Math.floor(Math.random() * SLOT_SYMBOLS.length);

export function createSlotsStage(ctx: StageContext): SlotsStage {
  const { PIXI, app, reduced } = ctx;
  const root = new PIXI.Container();
  app.stage.addChild(root);

  // Cabinet and reel windows.
  const cabinet = new PIXI.Graphics();
  cabinet.roundRect(X0 - 30, Y0 - 30, GRID_W + 60, GRID_H + 60, 34).fill({ color: 0x2a1670 });
  cabinet.roundRect(X0 - 24, Y0 - 24, GRID_W + 48, GRID_H + 48, 28).fill({ color: 0x6a4dff });
  cabinet.roundRect(X0 - 16, Y0 - 16, GRID_W + 32, GRID_H + 32, 22).fill({ color: 0x120a33 });
  for (let c = 0; c < COLS; c++) cabinet.roundRect(colX(c) - CELL / 2, Y0, CELL, GRID_H, 14).fill({ color: 0x1d1350 });

  const bulbs = new PIXI.Container();
  for (let i = 0; i < 24; i++) {
    const side = i % 2 === 0 ? X0 - 20 : X0 + GRID_W + 20;
    const b = glowCircle(new PIXI.Graphics(), 0, 0, 4, 0xffc83d, 1.5).circle(0, 0, 3.5).fill({ color: 0xffe08a });
    b.position.set(side, Y0 + 6 + Math.floor(i / 2) * ((GRID_H - 12) / 11));
    bulbs.addChild(b);
  }

  const reelLayer = new PIXI.Container();
  const reelMask = new PIXI.Graphics();
  for (let c = 0; c < COLS; c++) reelMask.roundRect(colX(c) - CELL / 2, Y0, CELL, GRID_H, 14).fill({ color: 0xffffff });
  reelLayer.mask = reelMask;
  const lineLayer = new PIXI.Graphics();
  lineLayer.blendMode = "add";
  const fx = new Fx(ctx);
  root.addChild(cabinet, bulbs, reelMask, reelLayer, lineLayer, fx.layer);

  const contexts: GraphicsContext[] = SLOT_SYMBOLS.map((_, s) =>
    new PIXI.GraphicsContext().svg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${slotSvg(s)}</svg>`),
  );

  const column = (c: number): Reel => {
    const layer: Container = new PIXI.Container();
    layer.x = colX(c);
    reelLayer.addChild(layer);
    // One extra cell above the window.
    const cells = Array.from({ length: ROWS + 1 }, (_, i) => {
      const g = new PIXI.Graphics(contexts[0]);
      g.pivot.set(32, 32);
      g.scale.set(ICON_SCALE);
      layer.addChild(g);
      return { g, row: i - 1 };
    });
    return { pos: 0, strip: new Map(), cells, stop: null, spinning: false };
  };
  const reels = Array.from({ length: COLS }, (_, c) => column(c));

  let time = 0;
  let resolveLand: (() => void) | null = null;
  let result: { wins: ReturnType<typeof slotWins>; elapsed: number; shown: number } | null = null;

  const symbolAt = (reel: Reel, k: number) => {
    let s = reel.strip.get(k);
    if (s === undefined) {
      s = randomSymbol();
      reel.strip.set(k, s);
    }
    return s;
  };

  const drawReel = (reel: Reel) => {
    const base = Math.floor(reel.pos);
    const frac = reel.pos - base;
    for (const cell of reel.cells) {
      const context = contexts[symbolAt(reel, base - cell.row)];
      if (cell.g.context !== context) cell.g.context = context;
      cell.g.y = rowY(cell.row) + frac * CELL;
    }
    // Forget what scrolled out of the window.
    for (const k of reel.strip.keys()) if (k < base - ROWS) reel.strip.delete(k);
  };

  const cellGraphics = (i: number) => reels[i % COLS].cells[Math.floor(i / COLS) + 1].g;

  const clearResult = () => {
    result = null;
    lineLayer.clear();
    for (const reel of reels)
      for (const cell of reel.cells) {
        cell.g.alpha = 1;
        cell.g.scale.set(ICON_SCALE);
      }
  };

  const setGrid = (grid: number[], reel: Reel, c: number, at: number) => {
    for (let r = 0; r < ROWS; r++) reel.strip.set(at - r, grid[r * COLS + c]);
  };

  const finish = () => {
    const r = resolveLand;
    resolveLand = null;
    r?.();
  };

  const showLine = (index: number) => {
    if (!result) return;
    const win = result.wins.lines[index];
    const color = slotColor(win.symbol);
    const [a, , b] = SLOT_LINES[win.line].map(cellPos);
    // Overshoot the outer cells a little so the line reads as crossing the whole board.
    const dx = (b.x - a.x) * 0.16;
    const dy = (b.y - a.y) * 0.16;
    for (const [width, alpha] of [[18, 0.12], [10, 0.2], [4, 0.9]] as const) {
      lineLayer.moveTo(a.x - dx, a.y - dy).lineTo(b.x + dx, b.y + dy).stroke({ width, color, alpha, cap: "round" });
    }
    for (const i of SLOT_LINES[win.line]) {
      const p = cellPos(i);
      fx.burst(p.x, p.y, color, 10, 4);
    }
    sfx.tick(index * 4);
  };

  const startResult = (grid: number[]) => {
    const wins = slotWins(grid);
    result = { wins, elapsed: 0, shown: 0 };
    const winning = new Set(wins.lines.flatMap((l) => SLOT_LINES[l.line]));
    if (winning.size > 0) grid.forEach((_, i) => (cellGraphics(i).alpha = winning.has(i) ? 1 : 0.3));
    if (wins.fullBoard) fx.ring(SLOTS_W / 2, SLOTS_H / 2, slotColor(grid[0]), 320, 4);
    if (reduced) {
      wins.lines.forEach((_, i) => showLine(i));
      result.shown = wins.lines.length;
    }
    if (reduced || wins.lines.length === 0) finish();
  };

  let pendingGrid: number[] | null = null;

  const tick = (t: Ticker) => {
    const dt = t.deltaMS;
    time += dt;
    const active = reels.some((r) => r.spinning || r.stop);
    bulbs.children.forEach((b, i) => {
      b.alpha = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(time / (active ? 90 : 420) + i * 0.9);
    });

    let moving = false;
    reels.forEach((reel, c) => {
      if (reel.stop) {
        const s = reel.stop;
        s.elapsed += dt;
        const k = Math.min(1, s.elapsed / s.duration);
        reel.pos = s.from + (s.to - s.from) * easeOutCubic(k);
        if (k >= 1) {
          reel.pos = s.to;
          reel.stop = null;
          sfx.land();
          fx.ring(colX(c), Y0 + GRID_H / 2, 0x9b8cff, 90, 2);
        } else moving = true;
        drawReel(reel);
      } else if (reel.spinning) {
        reel.pos += SPEED * dt;
        moving = true;
        drawReel(reel);
      }
    });
    if (pendingGrid && !moving) {
      const grid = pendingGrid;
      pendingGrid = null;
      startResult(grid);
    }

    if (result && result.wins.lines.length > 0) {
      const { wins } = result;
      result.elapsed += dt;
      while (result.shown < wins.lines.length && result.elapsed >= result.shown * LINE_MS) showLine(result.shown++);
      if (resolveLand && result.elapsed >= wins.lines.length * LINE_MS + 250) finish();
      if (!reduced) {
        const pulse = ICON_SCALE * (1 + 0.06 * Math.sin(result.elapsed / 140));
        for (const l of wins.lines) for (const i of SLOT_LINES[l.line]) cellGraphics(i).scale.set(pulse);
      }
    }
  };
  app.ticker.add(tick);
  // Opening board: no winning line, so it never looks like a result.
  const OPENING = [1, 2, 3, 5, 0, 6, 4, 3, 2];
  reels.forEach((reel, c) => {
    setGrid(OPENING, reel, c, 0);
    drawReel(reel);
  });

  /** Eases every spinning reel to a stop; the start speed matches the spin, so there is no jerk. */
  const stopReels = (grid: number[]) => {
    reels.forEach((reel, c) => {
      const to = Math.ceil(reel.pos) + ROWS + 2 + c * 3;
      setGrid(grid, reel, c, to);
      reel.spinning = false;
      reel.stop = { from: reel.pos, to, elapsed: 0, duration: (3 * (to - reel.pos)) / SPEED };
    });
  };

  return {
    spin() {
      pendingGrid = null;
      clearResult();
      if (reduced) return;
      for (const reel of reels) {
        reel.stop = null;
        reel.spinning = true;
      }
    },

    land(grid) {
      finish();
      clearResult();
      return new Promise<void>((resolve) => {
        resolveLand = resolve;
        if (reduced) {
          reels.forEach((reel, c) => {
            reel.spinning = false;
            reel.stop = null;
            reel.pos = Math.ceil(reel.pos) + ROWS;
            setGrid(grid, reel, c, reel.pos);
            drawReel(reel);
          });
          startResult(grid);
          return;
        }
        pendingGrid = grid;
        stopReels(grid);
      });
    },

    idle() {
      if (reels.some((r) => r.spinning)) stopReels(OPENING);
    },

    destroy() {
      app.ticker.remove(tick);
      fx.destroy();
      finish();
    },
  };
}
