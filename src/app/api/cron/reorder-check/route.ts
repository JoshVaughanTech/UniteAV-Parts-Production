import { runReorderDigest } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * Daily reorder digest. Triggered by Vercel Cron (see vercel.json). When CRON_SECRET
 * is set, Vercel sends it as a Bearer token and we reject anything else.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  }
  const result = await runReorderDigest();
  return Response.json(result);
}
