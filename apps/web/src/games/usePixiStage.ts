"use client";

import { useEffect, useRef, useState } from "react";
import type { Application } from "pixi.js";

export type Pixi = typeof import("pixi.js");

export interface StageContext {
  app: Application;
  PIXI: Pixi;
  /** Logical size of the scene; the canvas is scaled by CSS to the host's width. */
  width: number;
  height: number;
  /** Resolved CSS font stacks (canvas text cannot read CSS variables). */
  fonts: { display: string; mono: string };
  /** When true, stages jump straight to the final state instead of animating. */
  reduced: boolean;
}

export interface Stage {
  destroy(): void;
}

function cssFont(variable: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

/**
 * Mounts a PixiJS scene into a host div. Pixi is imported lazily so it never runs during
 * prerender; init is async, so a cancelled flag covers StrictMode's double effect and fast
 * unmounts. Pixi falls back to its canvas renderer without WebGL; if it cannot start at all `failed` becomes
 * true, the stage stays null and callers skip the animation or fall back to plain controls.
 */
export function usePixiStage<S extends Stage>(width: number, height: number, create: (ctx: StageContext) => S) {
  // A callback ref: the host may mount later (e.g. after the wallet connects), which must re-run init.
  const [host, hostRef] = useState<HTMLDivElement | null>(null);
  const stageRef = useRef<S | null>(null);
  const createRef = useRef(create);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    createRef.current = create;
  });

  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    let app: Application | null = null;

    (async () => {
      const PIXI = await import("pixi.js");
      await document.fonts?.ready;
      if (cancelled) return;
      const a = new PIXI.Application();
      await a.init({
        width,
        height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(3, (window.devicePixelRatio || 1) * 1.5),
        preference: "webgl",
      });
      if (cancelled) {
        a.destroy({ removeView: true }, { children: true });
        return;
      }
      app = a;
      Object.assign(a.canvas.style, { width: "100%", height: "auto", display: "block" });
      host.appendChild(a.canvas);
      stageRef.current = createRef.current({
        app: a,
        PIXI,
        width,
        height,
        fonts: {
          display: cssFont("--font-rubik", "system-ui, sans-serif"),
          mono: cssFont("--font-geist-mono", "ui-monospace, monospace"),
        },
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      setReady(true);
    })().catch((e) => {
      console.warn("game canvas unavailable, animations disabled:", e);
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      stageRef.current?.destroy();
      stageRef.current = null;
      app?.destroy({ removeView: true }, { children: true });
      setReady(false);
    };
  }, [host, width, height]);

  return { hostRef, host, stageRef, ready, failed };
}
