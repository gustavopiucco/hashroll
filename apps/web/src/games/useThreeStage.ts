"use client";

import { useEffect, useRef, useState } from "react";
import type { WebGLRenderer } from "three";

export interface ThreeStageContext {
  renderer: WebGLRenderer;
  /** Positioned element that holds the canvas; stages may add DOM overlays to it. */
  host: HTMLElement;
  /** Resolved CSS font stacks (canvas text cannot read CSS variables). */
  fonts: { display: string; mono: string };
  /** When true, stages jump straight to the final state instead of animating. */
  reduced: boolean;
}

export interface ThreeStage {
  /** Called with the host's size in CSS pixels on mount and whenever it changes. */
  resize(width: number, height: number): void;
  /** Advances and draws one frame. */
  frame(dt: number): void;
  destroy(): void;
}

function cssFont(variable: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

/** Longest step handed to a stage, so a throttled tab does not skip a whole animation. */
const MAX_DT = 50;

/**
 * Three.js counterpart of usePixiStage. `load` must dynamically import the stage module, which keeps
 * three out of the main bundle and away from prerender. If WebGL is unavailable `failed` becomes true,
 * the stage stays null and callers fall back to plain controls.
 */
export function useThreeStage<S extends ThreeStage>(load: () => Promise<(ctx: ThreeStageContext) => S>) {
  const [host, hostRef] = useState<HTMLDivElement | null>(null);
  const stageRef = useRef<S | null>(null);
  const loadRef = useRef(load);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!host) return;
    let cancelled = false;
    let cleanup = () => {};

    (async () => {
      const [THREE, create] = await Promise.all([import("three"), loadRef.current()]);
      await document.fonts?.ready;
      if (cancelled) return;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("webgl2", { antialias: true, alpha: true });
      if (!context) throw new Error("WebGL 2 is not supported");
      const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true, alpha: true });
      cleanup = () => {
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", display: "block" });
      host.appendChild(renderer.domElement);

      const stage = create({
        renderer,
        host,
        fonts: {
          display: cssFont("--font-rubik", "system-ui, sans-serif"),
          mono: cssFont("--font-geist-mono", "ui-monospace, monospace"),
        },
        reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      stageRef.current = stage;

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = host;
        if (!w || !h) return;
        renderer.setSize(w, h);
        stage.resize(w, h);
        // setSize clears the canvas: redraw now instead of flashing until the next frame.
        stage.frame(0);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      let last = performance.now();
      renderer.setAnimationLoop(() => {
        const now = performance.now();
        stage.frame(Math.min(MAX_DT, now - last));
        last = now;
      });

      cleanup = () => {
        observer.disconnect();
        renderer.setAnimationLoop(null);
        stageRef.current = null;
        stage.destroy();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      };
      setReady(true);
    })().catch((e) => {
      console.warn("game canvas unavailable, animations disabled:", e);
      cleanup();
      cleanup = () => {};
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      cleanup();
      setReady(false);
    };
  }, [host]);

  return { hostRef, host, stageRef, ready, failed };
}
