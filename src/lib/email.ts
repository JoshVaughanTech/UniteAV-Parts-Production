import { prisma } from "@/lib/prisma";
import { getToOrderBySupplier, getSettings } from "@/lib/metrics";
import { fmtMoney, fmtNum } from "@/lib/format";

const APP_URL = process.env.APP_URL || "https://unite-av-parts-production.vercel.app";

/** Send an email via Resend's REST API. No-ops (skipped) if RESEND_API_KEY is unset. */
export async function sendEmail(args: {
  to: string[];
  subject: string;
  html: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true, error: "RESEND_API_KEY not set" };
  if (args.to.length === 0) return { ok: false, skipped: true, error: "No recipients" };
  const from = process.env.RESEND_FROM || "Unite AV Parts <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: args.to, subject: args.subject, html: args.html }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "send failed" };
  }
}

/** Recipients = ALERT_EMAILS override, else all active Admins/Managers. */
async function alertRecipients(): Promise<string[]> {
  const override = (process.env.ALERT_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (override.length) return override;
  const users = await prisma.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "MANAGER"] } },
    select: { email: true },
  });
  return users.map((u) => u.email);
}

interface DigestGroup {
  supplierName: string;
  parts: { partNumber: string; name: string; onHand: number; suggested: number; cost: number }[];
  total: number;
}

function digestHtml(groups: DigestGroup[], grandTotal: number, currency: string): string {
  const box = "border:1px solid #e1e0d9;border-radius:10px;margin:0 0 16px;overflow:hidden";
  const th = "text-align:left;padding:6px 10px;font-size:11px;color:#898781;text-transform:uppercase;border-bottom:1px solid #e1e0d9";
  const td = "padding:6px 10px;font-size:13px;border-bottom:1px solid #f0efec";
  const sections = groups
    .map(
      (g) => `
    <div style="${box}">
      <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#f9f9f7;font-weight:600">
        <span>${g.supplierName}</span><span>${fmtMoney(g.total, currency)}</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tr><th style="${th}">Part</th><th style="${th};text-align:right">On hand</th><th style="${th};text-align:right">Order qty</th><th style="${th};text-align:right">Est. cost</th></tr>
        ${g.parts
          .map(
            (p) => `<tr>
          <td style="${td}"><strong>${p.partNumber}</strong><br><span style="color:#898781;font-size:11px">${p.name}</span></td>
          <td style="${td};text-align:right">${fmtNum(p.onHand)}</td>
          <td style="${td};text-align:right"><strong>${fmtNum(p.suggested)}</strong></td>
          <td style="${td};text-align:right">${p.cost ? fmtMoney(p.cost * p.suggested, currency) : "—"}</td>
        </tr>`,
          )
          .join("")}
      </table>
    </div>`,
    )
    .join("");

  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0b0b0b;max-width:720px;margin:0 auto">
    <h2 style="margin:0 0 4px">Parts to reorder</h2>
    <p style="color:#52514e;margin:0 0 16px">${groups.reduce((n, g) => n + g.parts.length, 0)} line(s) · estimated ${fmtMoney(grandTotal, currency)}</p>
    ${sections}
    <p><a href="${APP_URL}/to-order" style="display:inline-block;background:#2a78d6;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">Open To-Order &amp; create POs →</a></p>
    <p style="color:#898781;font-size:11px">Unite AV — Parts &amp; Production · automated reorder digest</p>
  </div>`;
}

export interface DigestResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  lineCount: number;
  recipients: number;
}

/** Build and send the reorder digest. Skips sending when nothing needs ordering. */
export async function runReorderDigest(): Promise<DigestResult> {
  const [groups, settings] = await Promise.all([getToOrderBySupplier(), getSettings()]);
  const lineCount = groups.reduce((n, g) => n + g.parts.length, 0);
  if (lineCount === 0) return { ok: true, skipped: true, reason: "Nothing to reorder", lineCount: 0, recipients: 0 };

  const digestGroups: DigestGroup[] = groups.map((g) => ({
    supplierName: g.supplierName,
    total: g.total,
    parts: g.parts.map((p) => ({
      partNumber: p.partNumber,
      name: p.name,
      onHand: p.onHand,
      suggested: p.reorder.suggestedOrderQty,
      cost: p.unitCost ?? 0,
    })),
  }));
  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  const recipients = await alertRecipients();
  const send = await sendEmail({
    to: recipients,
    subject: `[Unite AV] ${lineCount} part(s) to reorder — ${fmtMoney(grandTotal, settings.currency)}`,
    html: digestHtml(digestGroups, grandTotal, settings.currency),
  });

  return {
    ok: send.ok,
    skipped: send.skipped,
    reason: send.error,
    lineCount,
    recipients: recipients.length,
  };
}
