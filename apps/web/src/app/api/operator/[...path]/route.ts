import { forwardOperatorRequest } from "@/lib/server/operatorProxy";

// Upload + inference takes ~15–20 s on Render, plus a possible free-tier cold start.
export const maxDuration = 150;

export async function POST(request: Request, ctx: RouteContext<"/api/operator/[...path]">) {
  const { path } = await ctx.params;
  return forwardOperatorRequest(request, path);
}
