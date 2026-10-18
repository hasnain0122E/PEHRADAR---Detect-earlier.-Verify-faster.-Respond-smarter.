import "server-only";

/**
 * Server-side boundary for operator write actions (M4).
 *
 * The browser posts to /api/operator/<path> on this web app. This module forwards the request
 * to the PehRadar API and adds `X-Operator-Key` from the server-only OPERATOR_API_KEY env var,
 * so the key never reaches browser JavaScript. Only the write calls the command center needs
 * are forwarded (M4 review + upload, M5 demo scenarios, M6B demo simulation); anything else is 404.
 */

const ALLOWED_PATHS = [
  /^detect\/fire$/,
  /^detections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(confirm|reject)$/,
  /^scenarios\/[a-z0-9-]{1,60}\/start$/,
  /^scenarios\/reset$/,
  // M6B demo network simulation: node online/offline and station availability flags.
  /^cameras\/status$/,
  /^fire-stations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/status$/,
];

/** Vercel Functions accept request bodies up to 4.5 MB; stay under it with multipart overhead. */
export const MAX_PROXY_BODY_BYTES = 4_500_000;
const UPSTREAM_TIMEOUT_MS = 150_000;

export interface ProxyEnv {
  NEXT_PUBLIC_API_BASE_URL?: string;
  OPERATOR_API_KEY?: string;
}

function error(status: number, code: string, message: string) {
  return Response.json({ error: { code, message, details: {} } }, { status });
}

/** Rejects cross-site form posts: a browser always sends Origin on cross-origin POSTs. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    new URL(request.url).host,
  ];
  return hosts.some((host) => host === originHost);
}

export async function forwardOperatorRequest(
  request: Request,
  segments: string[],
  env: ProxyEnv = process.env as ProxyEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const path = segments.join("/");
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    return error(404, "NOT_FOUND", "Unknown operator action");
  }
  if (!isSameOrigin(request)) {
    return error(403, "FORBIDDEN_ORIGIN", "Operator actions must come from this web app");
  }
  const baseUrl = env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return error(503, "API_NOT_CONFIGURED", "NEXT_PUBLIC_API_BASE_URL is not set on the web server");
  }
  const declared = Number(request.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > MAX_PROXY_BODY_BYTES) {
    return error(413, "UPLOAD_TOO_LARGE", "Upload exceeds the 4 MB limit of the web proxy");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_PROXY_BODY_BYTES) {
    return error(413, "UPLOAD_TOO_LARGE", "Upload exceeds the 4 MB limit of the web proxy");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;
  // When unset, the request goes without a key: the API allows that only outside production.
  const key = env.OPERATOR_API_KEY?.trim();
  if (key) headers["X-Operator-Key"] = key;

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${baseUrl}/api/v1/${path}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return error(504, "UPSTREAM_TIMEOUT", "The PehRadar API did not answer in time");
    }
    return error(502, "UPSTREAM_UNREACHABLE", "The PehRadar API could not be reached");
  }
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}
