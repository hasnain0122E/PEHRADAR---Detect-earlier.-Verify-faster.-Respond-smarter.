export type ApiErrorKind = "network" | "timeout" | "http" | "invalid_response";

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly status?: number,
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

async function getJson(path: string, options: ApiClientOptions, signal?: AbortSignal) {
  const { baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: combined,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeout.aborted) {
      throw new ApiError("timeout", `API did not respond within ${timeoutMs / 1000}s`);
    }
    throw new ApiError("network", "Cannot reach the API (offline, wrong URL, or CORS blocked)");
  }

  if (!response.ok) {
    throw new ApiError("http", `API returned HTTP ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new ApiError("invalid_response", "API returned a non-JSON response");
  }
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
  const body = await getJson("/api/v1/health", options, signal);
  if (!isHealthResponse(body)) {
    throw new ApiError("invalid_response", "Health response did not match the expected shape");
  }
  return body;
}
