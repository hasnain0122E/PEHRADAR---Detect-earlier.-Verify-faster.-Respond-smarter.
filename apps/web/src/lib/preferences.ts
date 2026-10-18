"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-viewer console preferences (M6B Settings). Browser storage only: they are conveniences,
 * never operational state, and every read and write tolerates blocked or empty storage.
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface Preferences {
  theme: Theme;
  /** Start the first demo scenario automatically when the console opens. */
  autoStart: boolean;
  /** Trigger delay for demo runs, seconds (sent with each start). */
  scenarioDelayS: number;
  /** Show resolved and rejected incidents on the live map (history layer). */
  showResolved: boolean;
  defaultView: "2d" | "3d";
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  autoStart: false,
  scenarioDelayS: 5,
  showResolved: false,
  defaultView: "3d",
};

export const DELAY_CHOICES = [5, 10, 20, 45] as const;

const KEY = "pehradar.preferences";
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: Preferences } | null = null;
/** Used only when storage is blocked. */
let memoryOnly: Preferences | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parsePreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const v = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: v.theme === "dark" || v.theme === "system" ? v.theme : "light",
      autoStart: v.autoStart === true,
      scenarioDelayS:
        typeof v.scenarioDelayS === "number" && v.scenarioDelayS >= 0 && v.scenarioDelayS <= 300
          ? v.scenarioDelayS
          : DEFAULT_PREFERENCES.scenarioDelayS,
      showResolved: v.showResolved === true,
      defaultView: v.defaultView === "2d" ? "2d" : "3d",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function snapshot(): Preferences {
  const raw = readRaw();
  if (!cache || cache.raw !== raw) cache = { raw, value: parsePreferences(raw) };
  return cache.value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => e.key === KEY && listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function savePreferences(next: Preferences) {
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(KEY, raw);
    cache = { raw, value: next };
  } catch {
    // Storage blocked: keep the choice for this page view only.
    cache = { raw: readRaw(), value: next };
    memoryOnly = next;
  }
  listeners.forEach((l) => l());
}


export function usePreferences(): [Preferences, (patch: Partial<Preferences>) => void] {
  const prefs = useSyncExternalStore(subscribe, () => memoryOnly ?? snapshot(), () => DEFAULT_PREFERENCES);
  const update = useCallback((patch: Partial<Preferences>) => {
    savePreferences({ ...(memoryOnly ?? snapshot()), ...patch });
  }, []);
  return [prefs, update];
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(listener: () => void) {
  const mq = window.matchMedia?.(DARK_QUERY);
  mq?.addEventListener?.("change", listener);
  return () => mq?.removeEventListener?.("change", listener);
}

/** The theme actually shown: "system" follows the operating system. */
export function useResolvedTheme(theme: Theme): ResolvedTheme {
  const systemDark = useSyncExternalStore(
    subscribeScheme,
    () => window.matchMedia?.(DARK_QUERY).matches ?? false,
    () => false,
  );
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}

/** Resolved theme from storage right now (not the hydration-time default). */
export function currentResolvedTheme(): ResolvedTheme {
  const theme = (memoryOnly ?? snapshot()).theme;
  if (theme !== "system") return theme;
  return window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light";
}
