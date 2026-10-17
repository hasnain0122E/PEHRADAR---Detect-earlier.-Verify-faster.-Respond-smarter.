/** Single place for the product display name (renaming the product is a one-line change). */
export const PRODUCT_NAME = "PehRadar";
export const PRODUCT_TAGLINE = "Detect earlier. Verify faster. Respond smarter.";

/**
 * API base URL from NEXT_PUBLIC_API_BASE_URL. Next.js inlines this at build time, so it must be
 * referenced literally. Returns null when unset so the UI can show a configuration error instead
 * of silently calling a guessed host.
 */
export function getApiBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}
