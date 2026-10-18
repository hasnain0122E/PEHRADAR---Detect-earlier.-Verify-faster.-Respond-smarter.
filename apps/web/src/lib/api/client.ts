import type {
  Camera,
  CameraStatus,
  Detection,
  DetectionResult,
  FireStation,
  Incident,
  IncidentDetail,
  ResetResult,
  ResetScope,
  ReviewInput,
  Scenario,
  ScenarioList,
  ScenarioRun,
  StationStatus,
} from "./types";

export type ApiErrorKind = "network" | "timeout" | "http" | "unauthorized" | "invalid_response";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
    /** Backend error code from the `{"error":{code,message,details}}` envelope, when present. */
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface HealthResponse {
  status: "ok";
  app: string;
  version: string;
}

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 5000;
/** Reads tolerate a Render free-tier cold start (Tracker K3). */
const READ_TIMEOUT_MS = 30_000;
/** Upload + inference: ~15–20 s on Render, plus a possible cold start. */
const ANALYZE_TIMEOUT_MS = 180_000;
const WRITE_TIMEOUT_MS = 60_000;

/** Same-origin Next.js route that adds the operator key on the server (app/api/operator). */
export const OPERATOR_PROXY_PATH = "/api/operator";
/** Default label written to the incident timeline for actions taken from this console. */
export const OPERATOR_LABEL = "Duty operator (demo console)";

interface RequestOptions extends ApiClientOptions {
  method?: "GET" | "POST";
  body?: BodyInit;
  contentType?: string;
}

function errorFromBody(status: number, body: unknown): ApiError {
  const envelope = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } })
    ?.error;
  const code = typeof envelope?.code === "string" ? envelope.code : undefined;
  const message =
    typeof envelope?.message === "string" ? envelope.message : `API returned HTTP ${status}`;
  const details =
    envelope?.details && typeof envelope.details === "object"
      ? (envelope.details as Record<string, unknown>)
      : undefined;
  return new ApiError(status === 401 ? "unauthorized" : "http", message, status, code, details);
}

function parseBody(status: number, text: string): unknown {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    if (status >= 200 && status < 300) {
      throw new ApiError("invalid_response", "API returned a non-JSON response");
    }
    throw new ApiError("http", `API returned HTTP ${status}`, status);
  }
  if (status < 200 || status >= 300) throw errorFromBody(status, body);
  return body;
}

async function requestJson(path: string, options: RequestOptions, signal?: AbortSignal) {
  const {
    baseUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    method = "GET",
    body,
    contentType,
  } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (contentType) headers["Content-Type"] = contentType;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, { method, headers, body, signal: combined });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeout.aborted) {
      throw new ApiError("timeout", `API did not respond within ${timeoutMs / 1000}s`);
    }
    throw new ApiError("network", "Cannot reach the API (offline, wrong URL, or CORS blocked)");
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiError("invalid_response", "API response could not be read");
  }
  return parseBody(response.status, text);
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.status === "ok" && typeof v.app === "string" && typeof v.version === "string";
}

export async function getHealth(
  options: ApiClientOptions,
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const body = await requestJson("/api/v1/health", options, signal);
  if (!isHealthResponse(body)) {
    throw new ApiError("invalid_response", "Health response did not match the expected shape");
  }
  return body;
}

function items<T>(body: unknown, what: string): T[] {
  const list = (body as { items?: unknown })?.items;
  if (!Array.isArray(list)) {
    throw new ApiError("invalid_response", `${what} response did not contain an items list`);
  }
  return list as T[];
}

function object<T>(body: unknown, what: string): T {
  if (typeof body !== "object" || body === null || typeof (body as { id?: unknown }).id !== "string")
    throw new ApiError("invalid_response", `${what} response did not match the expected shape`);
  return body as T;
}

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface AnalyzeOptions {
  onUploadProgress?: (progress: UploadProgress) => void;
  /** Called once the file has been fully sent, i.e. server-side analysis has started. */
  onUploaded?: () => void;
  signal?: AbortSignal;
}

/** Every call the command center makes. Components receive this, never raw fetch. */
export interface OpsApi {
  listCameras(signal?: AbortSignal): Promise<Camera[]>;
  listStations(signal?: AbortSignal): Promise<FireStation[]>;
  listIncidents(signal?: AbortSignal): Promise<Incident[]>;
  getIncident(id: string, signal?: AbortSignal): Promise<IncidentDetail>;
  listPendingDetections(signal?: AbortSignal): Promise<Detection[]>;
  getDetection(id: string, signal?: AbortSignal): Promise<Detection>;
  analyzeFootage(cameraId: string, file: File, options?: AnalyzeOptions): Promise<DetectionResult>;
  confirmDetection(id: string, input?: ReviewInput): Promise<IncidentDetail>;
  rejectDetection(id: string, input?: ReviewInput): Promise<Detection>;
  listScenarios(signal?: AbortSignal): Promise<ScenarioList>;
  startScenario(id: string, options?: { delayS?: number }): Promise<ScenarioRun>;
  resetScenarios(scope?: ResetScope): Promise<ResetResult>;
  /** Demo network simulation: every node, a district, or listed nodes online/offline. */
  setCameraStatus(input: { status: CameraStatus; district?: string; camera_ids?: string[] }): Promise<{ cameras_changed: number }>;
  /** Demo availability flag; changes which station is suggested for new incidents. */
  setStationStatus(id: string, status: StationStatus): Promise<FireStation>;
  /** Absolute URL for an API-relative evidence path (images load directly from the API). */
  evidenceSrc(path: string | null): string | null;
  /** Playable URL for a camera stream: API-relative demo media, or an absolute https stream. */
  mediaSrc(url: string | null): string | null;
}

export interface OpsApiConfig {
  /** Public API origin (NEXT_PUBLIC_API_BASE_URL) for reads and evidence images. */
  apiBaseUrl: string;
  /** Origin of the operator proxy; "" means this web app (same origin). */
  proxyBaseUrl?: string;
  fetchImpl?: typeof fetch;
  xhrFactory?: () => XMLHttpRequest;
}

/** multipart upload with real upload-progress events (fetch cannot report upload progress). */
function uploadForm(
  url: string,
  form: FormData,
  options: AnalyzeOptions,
  xhrFactory: () => XMLHttpRequest,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open("POST", url);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.timeout = ANALYZE_TIMEOUT_MS;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        options.onUploadProgress?.({ loaded: event.loaded, total: event.total });
      }
    };
    xhr.upload.onload = () => options.onUploaded?.();
    xhr.onload = () => {
      try {
        resolve(parseBody(xhr.status, xhr.responseText));
      } catch (err) {
        reject(err);
      }
    };
    xhr.onerror = () =>
      reject(new ApiError("network", "Upload failed: the web server could not be reached"));
    xhr.ontimeout = () =>
      reject(
        new ApiError("timeout", `Analysis did not finish within ${ANALYZE_TIMEOUT_MS / 1000}s`),
      );
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export function createOpsApi(config: OpsApiConfig): OpsApi {
  const { apiBaseUrl, proxyBaseUrl = "", fetchImpl } = config;
  const xhrFactory = config.xhrFactory ?? (() => new XMLHttpRequest());
  const read = { baseUrl: apiBaseUrl, fetchImpl, timeoutMs: READ_TIMEOUT_MS };
  const proxy = `${proxyBaseUrl}${OPERATOR_PROXY_PATH}`;

  const write = (path: string, input: object = {}) =>
    requestJson(`${OPERATOR_PROXY_PATH}/${path}`, {
      baseUrl: proxyBaseUrl,
      fetchImpl,
      timeoutMs: WRITE_TIMEOUT_MS,
      method: "POST",
      body: JSON.stringify({ operator: OPERATOR_LABEL, ...input }),
      contentType: "application/json",
    });
  const review = (id: string, action: "confirm" | "reject", input: ReviewInput = {}) =>
    write(`detections/${encodeURIComponent(id)}/${action}`, input);

  return {
    listCameras: async (signal) =>
      items<Camera>(await requestJson("/api/v1/cameras", read, signal), "Cameras"),
    // M6C: every response facility (fire, police, ambulance); `category` tells them apart.
    listStations: async (signal) =>
      items<FireStation>(await requestJson("/api/v1/response-facilities", read, signal), "Stations"),
    listIncidents: async (signal) =>
      items<Incident>(await requestJson("/api/v1/incidents", read, signal), "Incidents"),
    getIncident: async (id, signal) =>
      object<IncidentDetail>(
        await requestJson(`/api/v1/incidents/${encodeURIComponent(id)}`, read, signal),
        "Incident",
      ),
    listPendingDetections: async (signal) =>
      items<Detection>(
        await requestJson("/api/v1/detections?review_status=pending", read, signal),
        "Detections",
      ),
    getDetection: async (id, signal) =>
      object<Detection>(
        await requestJson(`/api/v1/detections/${encodeURIComponent(id)}`, read, signal),
        "Detection",
      ),
    analyzeFootage: async (cameraId, file, options = {}) => {
      const form = new FormData();
      form.append("camera_id", cameraId);
      form.append("file", file, file.name);
      const body = await uploadForm(`${proxy}/detect/fire`, form, options, xhrFactory);
      const status = (body as { status?: unknown })?.status;
      if (status !== "detected" && status !== "not_detected") {
        throw new ApiError("invalid_response", "Detection response did not match the contract");
      }
      return body as DetectionResult;
    },
    confirmDetection: async (id, input) =>
      object<IncidentDetail>(await review(id, "confirm", input), "Incident"),
    rejectDetection: async (id, input) =>
      object<Detection>(await review(id, "reject", input), "Detection"),
    listScenarios: async (signal) => {
      const body = await requestJson("/api/v1/scenarios", read, signal);
      if (typeof (body as { enabled?: unknown })?.enabled !== "boolean") {
        throw new ApiError("invalid_response", "Scenarios response did not match the contract");
      }
      items<Scenario>(body, "Scenarios");
      return body as ScenarioList;
    },
    startScenario: async (id, options = {}) =>
      object<ScenarioRun>(
        await write(
          `scenarios/${encodeURIComponent(id)}/start`,
          options.delayS !== undefined ? { delay_s: options.delayS } : {},
        ),
        "Scenario run",
      ),
    resetScenarios: async (scope = "demo") => {
      const body = await write("scenarios/reset", { scope });
      const key = scope === "full" ? "incidents_deleted" : "runs_cancelled";
      if (typeof (body as Record<string, unknown>)?.[key] !== "number") {
        throw new ApiError("invalid_response", "Reset response did not match the contract");
      }
      return body as ResetResult;
    },
    setCameraStatus: async (input) => {
      const body = await write("cameras/status", input);
      if (typeof (body as { cameras_changed?: unknown })?.cameras_changed !== "number") {
        throw new ApiError("invalid_response", "Camera status response did not match the contract");
      }
      return body as { cameras_changed: number };
    },
    setStationStatus: async (id, status) =>
      object<FireStation>(await write(`fire-stations/${encodeURIComponent(id)}/status`, { status }), "Station"),
    evidenceSrc: (path) => (path ? `${apiBaseUrl}${path}` : null),
    mediaSrc: (url) => {
      if (!url) return null;
      if (url.startsWith("/")) return `${apiBaseUrl}${url}`;
      return url.startsWith("https://") ? url : null; // a public stream must be https
    },
  };
}
