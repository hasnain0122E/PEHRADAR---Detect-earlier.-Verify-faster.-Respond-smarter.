"use client";

import { motion } from "motion/react";

import { PRODUCT_TAGLINE } from "@/lib/config";

import { Icon } from "../icons";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Centered logo and tagline on navy: the bridge between the landing page and the console. */
export function IntroOverlay() {
  return (
    <motion.div
      role="status"
      aria-label="Starting monitoring"
      className="fixed inset-0 z-[100] grid place-items-center bg-[#0b1220] text-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <div className="grid justify-items-center gap-5">
        <motion.span
          className="relative grid h-20 w-20 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/15"
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.25, ease: EASE }}
        >
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-2xl ring-2 ring-[#4f8bff]/50"
            initial={{ scale: 1, opacity: 0 }}
            animate={{ scale: [1, 1.35], opacity: [0.6, 0] }}
            transition={{ duration: 1.4, delay: 0.7, ease: "easeOut", repeat: 1 }}
          />
          <Icon name="radar" size={40} />
        </motion.span>
        <motion.p
          className="text-3xl font-semibold tracking-[0.28em]"
          initial={{ y: 10, opacity: 0, letterSpacing: "0.4em" }}
          animate={{ y: 0, opacity: 1, letterSpacing: "0.28em" }}
          transition={{ duration: 0.7, delay: 0.55, ease: EASE }}
        >
          PEHRADAR
        </motion.p>
        <motion.p
          className="text-sm text-white/70"
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.0, ease: EASE }}
        >
          {PRODUCT_TAGLINE}
        </motion.p>
        <motion.span
          aria-hidden
          className="mt-2 h-0.5 w-40 overflow-hidden rounded-full bg-white/10"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.1 }}
        >
          <motion.span
            className="block h-full w-full origin-left rounded-full bg-[#4f8bff]"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.1, delay: 1.15, ease: "easeInOut" }}
          />
        </motion.span>
      </div>
    </motion.div>
  );
}
