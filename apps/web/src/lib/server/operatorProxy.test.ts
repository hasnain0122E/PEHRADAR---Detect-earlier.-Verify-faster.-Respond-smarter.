import { describe, expect, it, vi } from "vitest";

import { forwardOperatorRequest, MAX_PROXY_BODY_BYTES } from "./operatorProxy";

const ENV = { NEXT_PUBLIC_API_BASE_URL: "https://api.test/", OPERATOR_API_KEY: "server-secret-key" };
const DETECTION = "3401c1ec-0037-44d1-ba70-c441fecc422a";

function post(path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
  return new Request(`http://web.test/api/operator/${path}`, {
    method: "POST",
    body: init.body ?? "{}",
    headers: { host: "web.test", "content-type": "application/json", ...init.headers },
  });
}

describe("forwardOperatorRequest", () => {
  it("adds the operator key on the server and forwards to the API", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ id: "inc-1" }));

    const res = await forwardOperatorRequest(
      post(`detections/${DETECTION}/confirm`, { headers: { origin: "http://web.test" } }),
      ["detections", DETECTION, "confirm"],
      ENV,
      fetchImpl,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: "inc-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://api.test/api/v1/detections/${DETECTION}/confirm`);
    expect(init.headers["X-Operator-Key"]).toBe("server-secret-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("passes API errors through and never echoes the key", async () => {
    const body = { error: { code: "UNAUTHORIZED", message: "Missing or invalid X-Operator-Key header" } };
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(body, { status: 401 }));

    const res = await forwardOperatorRequest(post("detect/fire"), ["detect", "fire"], ENV, fetchImpl);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toContain("UNAUTHORIZED");
    expect(text).not.toContain("server-secret-key");
    expect([...res.headers.values()].join(" ")).not.toContain("server-secret-key");
  });

  it("forwards without a key when none is configured (the API decides)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({}));
    await forwardOperatorRequest(
      post("detect/fire"),
      ["detect", "fire"],
      { NEXT_PUBLIC_API_BASE_URL: "https://api.test" },
      fetchImpl,
    );
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("X-Operator-Key");
  });

  it.each([
    [["incidents", "x", "status"]],
    [["detections", "not-a-uuid", "confirm"]],
    [["detections", DETECTION, "delete"]],
    [["health"]],
  ])("refuses paths outside the allowlist: %j", async (segments) => {
    const fetchImpl = vi.fn();
    const res = await forwardOperatorRequest(post(segments.join("/")), segments, ENV, fetchImpl);
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses cross-site requests", async () => {
    const fetchImpl = vi.fn();
    const res = await forwardOperatorRequest(
      post("detect/fire", { headers: { origin: "https://evil.example" } }),
      ["detect", "fire"],
      ENV,
      fetchImpl,
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses bodies over the proxy limit", async () => {
    const fetchImpl = vi.fn();
    const big = new Uint8Array(MAX_PROXY_BODY_BYTES + 1);
    const res = await forwardOperatorRequest(
      post("detect/fire", { body: big }),
      ["detect", "fire"],
      ENV,
      fetchImpl,
    );
    expect(res.status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an unreachable API as 502 and a missing API URL as 503", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const unreachable = await forwardOperatorRequest(post("detect/fire"), ["detect", "fire"], ENV, down);
    expect(unreachable.status).toBe(502);
    const unconfigured = await forwardOperatorRequest(post("detect/fire"), ["detect", "fire"], {}, vi.fn());
    expect(unconfigured.status).toBe(503);
  });
});
