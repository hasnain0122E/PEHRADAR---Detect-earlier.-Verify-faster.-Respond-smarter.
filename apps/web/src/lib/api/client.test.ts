import { describe, expect, it, vi } from "vitest";

import { ApiError, createOpsApi, getHealth } from "./client";

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

describe("createOpsApi", () => {
  const DETECTION = "3401c1ec-0037-44d1-ba70-c441fecc422a";

  it("reads lists directly from the public API", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ items: [{ id: "c1" }] }));
    const api = createOpsApi({ apiBaseUrl: BASE, fetchImpl });

    await expect(api.listCameras()).resolves.toEqual([{ id: "c1" }]);
    await api.listPendingDetections();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${BASE}/api/v1/cameras`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${BASE}/api/v1/detections?review_status=pending`,
      expect.anything(),
    );
  });

  it("parses the API error envelope (code, message, details)", async () => {
    const body = {
      error: {
        code: "DETECTION_ALREADY_REVIEWED",
        message: "Detection was already confirmed",
        details: { incident_id: "i1" },
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body, 409));
    const api = createOpsApi({ apiBaseUrl: BASE, fetchImpl });

    const err = await api.confirmDetection(DETECTION).catch((e: unknown) => e);
    expect(err).toMatchObject({
      kind: "http",
      status: 409,
      code: "DETECTION_ALREADY_REVIEWED",
      message: "Detection was already confirmed",
      details: { incident_id: "i1" },
    });
  });

  it("maps 401 to an unauthorized error", async () => {
    const body = { error: { code: "UNAUTHORIZED", message: "Missing or invalid X-Operator-Key header" } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(body, 401));
    const api = createOpsApi({ apiBaseUrl: BASE, fetchImpl });

    await expectApiError(api.rejectDetection(DETECTION), "unauthorized");
  });

  it("sends review actions to the same-origin operator proxy without any key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: "inc-1" }));
    const api = createOpsApi({ apiBaseUrl: BASE, fetchImpl });

    await api.rejectDetection(DETECTION, { note: "glare" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`/api/operator/detections/${DETECTION}/reject`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ operator: "Duty operator (demo console)", note: "glare" });
    expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("x-operator-key");
  });

  it("uploads footage through the proxy with real upload-progress events", async () => {
    const sent: { url?: string; body?: FormData; headers: Record<string, string> } = { headers: {} };
    class FakeXhr {
      status = 200;
      responseText = JSON.stringify({ status: "not_detected" });
      timeout = 0;
      upload: { onprogress?: (e: unknown) => void; onload?: () => void } = {};
      onload?: () => void;
      open(_method: string, url: string) {
        sent.url = url;
      }
      setRequestHeader(name: string, value: string) {
        sent.headers[name] = value;
      }
      send(body: FormData) {
        sent.body = body;
        this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.upload.onload?.();
        this.onload?.();
      }
      abort() {}
    }
    const progress = vi.fn();
    const uploaded = vi.fn();
    const api = createOpsApi({
      apiBaseUrl: BASE,
      xhrFactory: () => new FakeXhr() as unknown as XMLHttpRequest,
    });

    const file = new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" });
    await expect(
      api.analyzeFootage("cam-1", file, { onUploadProgress: progress, onUploaded: uploaded }),
    ).resolves.toEqual({ status: "not_detected" });
    expect(sent.url).toBe("/api/operator/detect/fire");
    expect(sent.body?.get("camera_id")).toBe("cam-1");
    expect((sent.body?.get("file") as File).name).toBe("clip.mp4");
    expect(Object.keys(sent.headers).map((h) => h.toLowerCase())).not.toContain("x-operator-key");
    expect(progress).toHaveBeenCalledWith({ loaded: 50, total: 100 });
    expect(uploaded).toHaveBeenCalledOnce();
  });

  it("builds absolute evidence URLs on the API origin", () => {
    const api = createOpsApi({ apiBaseUrl: BASE });
    expect(api.evidenceSrc("/api/v1/detections/x/evidence.jpg")).toBe(
      `${BASE}/api/v1/detections/x/evidence.jpg`,
    );
    expect(api.evidenceSrc(null)).toBeNull();
  });
});

describe("createOpsApi (M5 scenarios and media)", () => {
  it("reads scenarios from the API and starts/resets them through the operator proxy", async () => {
    const list = { enabled: true, server_time: "2026-10-17T19:00:00+00:00", items: [] };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(list))
      .mockResolvedValueOnce(jsonResponse({ id: "run-1", status: "scheduled" }))
      .mockResolvedValueOnce(jsonResponse({ runs_cancelled: 1, detections_closed: 0, incidents_closed: 0 }));
    const api = createOpsApi({ apiBaseUrl: BASE, fetchImpl });

    await expect(api.listScenarios()).resolves.toEqual(list);
    await expect(api.startScenario("korangi-industrial-fire")).resolves.toMatchObject({ id: "run-1" });
    await expect(api.resetScenarios()).resolves.toMatchObject({ runs_cancelled: 1 });
    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      `${BASE}/api/v1/scenarios`,
      "/api/operator/scenarios/korangi-industrial-fire/start",
      "/api/operator/scenarios/reset",
    ]);
    for (const [, init] of fetchImpl.mock.calls.slice(1)) {
      expect(Object.keys(init.headers).map((h: string) => h.toLowerCase())).not.toContain("x-operator-key");
    }
  });

  it("rejects a scenarios response without the enabled flag", async () => {
    const api = createOpsApi({ apiBaseUrl: BASE, fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ items: [] })) });
    await expect(api.listScenarios()).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("resolves demo media on the API origin and only https public streams", () => {
    const api = createOpsApi({ apiBaseUrl: BASE });
    expect(api.mediaSrc("/api/v1/media/fire.mp4")).toBe(`${BASE}/api/v1/media/fire.mp4`);
    expect(api.mediaSrc("https://cam.example/live.m3u8")).toBe("https://cam.example/live.m3u8");
    expect(api.mediaSrc("http://cam.example/live.m3u8")).toBeNull();
    expect(api.mediaSrc("javascript:alert(1)")).toBeNull();
    expect(api.mediaSrc(null)).toBeNull();
  });
});
