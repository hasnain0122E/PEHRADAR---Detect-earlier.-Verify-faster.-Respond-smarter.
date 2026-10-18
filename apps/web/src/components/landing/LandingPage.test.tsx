import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LandingPage } from "./LandingPage";
import { INTRO_FLAG } from "./StartMonitoring";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch: vi.fn() }) }));

describe("LandingPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    push.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it("presents the product in one page with the required sections", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      /PEHRADAR.*Detect earlier\. Verify faster\. Respond smarter\./,
    );
    expect(screen.getByText(/AI-powered fire monitoring and emergency response command center/)).toBeInTheDocument();
    for (const title of [/Minutes matter/, /four steps/, /Everything an operator needs/, /A human confirms every incident/]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "View Features" })).toHaveAttribute("href", "#features");
    expect(screen.getAllByRole("button", { name: "Start Monitoring" })).toHaveLength(2);
    // Honest about what is simulated.
    expect(screen.getByText(/no official or Safe City CCTV is connected/)).toBeInTheDocument();
  });

  it("Start Monitoring plays the intro, then opens the command center", () => {
    render(<LandingPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Start Monitoring" })[0]);

    expect(screen.getByRole("status", { name: "Starting monitoring" })).toBeInTheDocument();
    expect(window.sessionStorage.getItem(INTRO_FLAG)).toBe("1");
    act(() => vi.advanceTimersByTime(2000));
    expect(push).not.toHaveBeenCalled(); // the intro is not cut short
    act(() => vi.advanceTimersByTime(500));
    expect(push).toHaveBeenCalledWith("/monitor");
  });
});
