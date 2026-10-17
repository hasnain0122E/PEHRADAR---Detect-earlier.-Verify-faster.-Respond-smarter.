"use client";

import { useMemo } from "react";

import { createOpsApi } from "@/lib/api/client";
import { getApiBaseUrl } from "@/lib/config";

import { ApiStatus } from "../ApiStatus";
import { CommandCenter } from "./CommandCenter";

/** Builds the API client from public config. Writes go through the same-origin operator proxy. */
export function CommandCenterRoot() {
  const apiBaseUrl = getApiBaseUrl();
  const api = useMemo(() => (apiBaseUrl ? createOpsApi({ apiBaseUrl }) : null), [apiBaseUrl]);

  if (!apiBaseUrl || !api) {
    return (
      <main className="mx-auto grid w-full max-w-xl flex-1 content-center gap-4 px-4 py-10">
        <h1 className="text-xl font-semibold">PehRadar command center</h1>
        <ApiStatus />
      </main>
    );
  }
  return <CommandCenter api={api} apiBaseUrl={apiBaseUrl} />;
}
