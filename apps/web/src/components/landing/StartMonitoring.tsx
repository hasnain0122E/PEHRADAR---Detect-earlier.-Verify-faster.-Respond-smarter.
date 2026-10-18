"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { Icon } from "../icons";
import { IntroOverlay } from "./IntroOverlay";

export const MONITOR_PATH = "/monitor";
/** Read by the console's entry reveal: set only when the operator came through the intro. */
export const INTRO_FLAG = "pehradar.intro";
/** Landing exit + logo + tagline: about 2.4 s before the console opens (then a 0.5 s reveal). */
const INTRO_MS = 2400;

const LaunchContext = createContext<() => void>(() => {});

/**
 * Wraps the landing page. Start Monitoring fades and scales the page out, shows the centered
 * logo and tagline, then opens the command center. Reduced motion: straight to the console.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    router.prefetch(MONITOR_PATH);
  }, [router]);

  useEffect(() => {
    if (!launching) return;
    try {
      window.sessionStorage.setItem(INTRO_FLAG, "1");
    } catch {
      // Storage blocked: the console simply opens without the reveal.
    }
    const id = setTimeout(() => router.push(MONITOR_PATH), reduced ? 0 : INTRO_MS);
    return () => clearTimeout(id);
  }, [launching, reduced, router]);

  return (
    <LaunchContext.Provider value={() => setLaunching(true)}>
      <motion.div
        className="flex min-h-dvh flex-col"
        animate={launching ? { opacity: 0, scale: 0.98 } : { opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
      <AnimatePresence>{launching && !reduced && <IntroOverlay key="intro" />}</AnimatePresence>
    </LaunchContext.Provider>
  );
}

export function StartMonitoringButton({ className, children }: { className: string; children?: ReactNode }) {
  const launch = useContext(LaunchContext);
  return (
    <button type="button" onClick={launch} className={className}>
      {children ?? "Start Monitoring"}
      <Icon name="arrowRight" size={18} />
    </button>
  );
}
