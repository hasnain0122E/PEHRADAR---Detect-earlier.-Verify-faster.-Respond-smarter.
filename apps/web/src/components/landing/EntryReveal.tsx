"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { PRODUCT_TAGLINE } from "@/lib/config";

import { Icon } from "../icons";
import { INTRO_FLAG } from "./StartMonitoring";

const noopSubscribe = () => () => {};
const cameThroughIntro = () => {
  try {
    return window.sessionStorage.getItem(INTRO_FLAG) === "1";
  } catch {
    return false;
  }
};

/**
 * Last beat of the Start Monitoring intro: the navy logo screen fades away over the console.
 * Only after the landing intro (session flag); a direct visit to /monitor opens straight away.
 */
export function EntryReveal() {
  const fromIntro = useSyncExternalStore(noopSubscribe, cameThroughIntro, () => false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!fromIntro) return;
    try {
      window.sessionStorage.removeItem(INTRO_FLAG);
    } catch {
      // ignore
    }
    const id = setTimeout(() => setDone(true), 250);
    return () => clearTimeout(id);
  }, [fromIntro]);

  return (
    <AnimatePresence>
      {fromIntro && !done && (
        <motion.div
          key="reveal"
          aria-hidden
          className="fixed inset-0 z-[100] grid place-items-center bg-[#0b1220] text-white"
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="grid justify-items-center gap-5">
            <span className="grid h-20 w-20 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <Icon name="radar" size={40} />
            </span>
            <p className="text-3xl font-semibold tracking-[0.28em]">PEHRADAR</p>
            <p className="text-sm text-white/70">{PRODUCT_TAGLINE}</p>
            <span className="mt-2 block h-0.5 w-40 rounded-full bg-[#4f8bff]" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
