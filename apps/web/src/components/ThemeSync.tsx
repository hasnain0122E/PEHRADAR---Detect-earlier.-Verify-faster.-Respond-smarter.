"use client";

import { useEffect } from "react";

import { currentResolvedTheme, usePreferences, useResolvedTheme } from "@/lib/preferences";

/** Keeps <html data-theme> in step with the theme preference and the OS setting ("system"). */
export function ThemeSync() {
  const [prefs] = usePreferences();
  const theme = useResolvedTheme(prefs.theme);
  useEffect(() => {
    // Read storage directly: during hydration `theme` is still the server default.
    document.documentElement.setAttribute("data-theme", currentResolvedTheme());
  }, [theme]);
  return null;
}
