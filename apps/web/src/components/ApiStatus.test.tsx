import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiStatus } from "./ApiStatus";

const HEALTHY = { status: "ok", app: "pehradar-api", version: "0.1.0" };

function okResponse() {
  return new Response(JSON.stringify(HEALTHY), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiStatus", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("shows loading, then connected with service details", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/");
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    render(<ApiStatus fetchImpl={fetchImpl} />);

    expect(screen.getByRole("status")).toHaveTextContent("Checking…");
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("pehradar-api v0.1.0")).toBeInTheDocument();
    // Trailing slash in the env value is normalised.
    expect(fetchImpl).toHaveBeenCalledWith("http://api.test/api/v1/health", expect.anything());
  });

  it("shows disconnected with the reason, and recovers on retry", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test");
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(okResponse());

    render(<ApiStatus fetchImpl={fetchImpl} />);

    expect(await screen.findByText("Disconnected")).toBeInTheDocument();
    expect(screen.getByText(/Cannot reach the API/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });

  it("explains missing configuration without calling any URL", () => {
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "");
    const fetchImpl = vi.fn();

    render(<ApiStatus fetchImpl={fetchImpl} />);

    expect(screen.getByRole("status")).toHaveTextContent("Not configured");
    expect(screen.getByText(/NEXT_PUBLIC_API_BASE_URL is not set/)).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
