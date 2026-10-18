import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // Console preferences (M6B) live in localStorage; every test starts from the defaults.
  window.localStorage.clear();
});

// jsdom has no media playback; CameraFeed only needs play() to exist and settle.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: () => Promise.resolve(),
});
