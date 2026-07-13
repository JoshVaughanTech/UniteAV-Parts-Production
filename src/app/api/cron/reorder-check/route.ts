import { runReorderDigest } from "@/lib/email";
import { runAutoOrder } from "@/lib/auto-order";

export const dynamic = "force-dynamic";

/**
 * Daily automation. Triggered by Vercel Cron (see vercel.json). When CRON_SECRET is
 * set, Vercel sends it as a Bearer token and we reject anything else.
 * Runs auto-ordering first (if enabled) so those parts drop off the digest, then
 * emails the reorder digest for anything still needing attention.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  }
  const autoOrder = await runAutoOrder();
  const digest = await runReorderDigest();
  return Response.json({ autoOrder, digest });
}
