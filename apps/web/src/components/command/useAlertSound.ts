"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "pehradar.alertSound";
const MIN_GAP_MS = 3000;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const noopSubscribe = () => () => {};

/** Short two-tone chime synthesized with Web Audio (no audio file). Design.md §12. */
function chime(ctx: AudioContext) {
  const start = ctx.currentTime + 0.01;
  [880, 660].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
}

/**
 * Alert sound is off until the operator clicks "Enable alert sound" (browsers block audio
 * without a prior user gesture). The preference is remembered, but after a reload audio still
 * waits for the next click anywhere on the page to unlock.
 */
export function useAlertSound() {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const lastPlayed = useRef(0);
  // false during server rendering, real value after hydration (no mismatch).
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => audioContextCtor() !== null,
    () => false,
  );

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "on") {
        // Restore the preference; the context is created on the next user gesture.
        const unlock = () => {
          const Ctor = audioContextCtor();
          if (Ctor && !ctxRef.current) ctxRef.current = new Ctor();
          setEnabled(true);
        };
        window.addEventListener("pointerdown", unlock, { once: true });
        return () => window.removeEventListener("pointerdown", unlock);
      }
    } catch {
      // Storage blocked: sound simply starts off.
    }
  }, []);

  const enable = useCallback(() => {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    ctxRef.current ??= new Ctor();
    void ctxRef.current.resume();
    chime(ctxRef.current);
    setEnabled(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "on");
    } catch {}
  }, []);

  const disable = useCallback(() => {
    setEnabled(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "off");
    } catch {}
  }, []);

  const play = useCallback(() => {
    const ctx = ctxRef.current;
    if (!enabled || !ctx) return;
    const now = Date.now();
    if (now - lastPlayed.current < MIN_GAP_MS) return;
    lastPlayed.current = now;
    void ctx.resume();
    chime(ctx);
  }, [enabled]);

  return { supported, enabled, enable, disable, play };
}
