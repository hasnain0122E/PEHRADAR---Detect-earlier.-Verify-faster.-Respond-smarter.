import { describe, expect, it, vi } from "vitest";

import { ApiError, getHealth } from "./client";

const BASE = "http://api.test";
const HEALTHY = { status: "ok", app: "pehradar-api", version: "0.1.0" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function expectApiError(promise: Promise<unknown>, kind: ApiError["kind"]) {
  const err = await promise.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).kind).toBe(kind);
}

describe("getHealth", () => {
  it("calls the versioned health endpoint and returns the payload", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(HEALTHY));

    await expect(getHealth({ baseUrl: BASE, fetchImpl })).resolves.toEqual(HEALTHY);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/api/v1/health`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reports HTTP failures with the status code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ detail: "boom" }, 503));

    const err = await getHealth({ baseUrl: BASE, fetchImpl }).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind: "http", status: 503 });
  });

  it("reports network failures (offline or CORS-blocked) as network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expectApiError(getHealth({ baseUrl: BASE, fetchImpl }), "network");
  });

  it("rejects a response that does not match the health contract", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: "degraded" }));

    await expectApiError(getHealth({ baseUrl: BASE, fetchImpl }), "invalid_response");
  });

  it("rejects non-JSON bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>", { status: 200 }));

    await expectApiError(getHealth({ baseUrl: BASE, fetchImpl }), "invalid_response");
  });

  it("times out when the API does not answer", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    await expectApiError(
      getHealth({ baseUrl: BASE, fetchImpl: fetchImpl as typeof fetch, timeoutMs: 20 }),
      "timeout",
    );
  });
});
