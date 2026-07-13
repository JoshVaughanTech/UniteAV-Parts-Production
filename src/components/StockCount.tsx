"use client";

import { useEffect, useRef, useState } from "react";
import { setStockCount } from "@/lib/count-actions";
import { input, btnPrimary, btnGhost } from "@/components/ui";
import { fmtNum } from "@/lib/format";

interface Part {
  id: string;
  partNumber: string;
  name: string;
  mpn: string | null;
  onHand: number;
}

export function StockCount({ parts: initial }: { parts: Part[] }) {
  const [parts, setParts] = useState<Part[]>(initial);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Part | null>(null);
  const [count, setCount] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [log, setLog] = useState<{ partNumber: string; from: number; to: number }[]>([]);
  const [scanning, setScanning] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);

  function findByCode(code: string): Part | null {
    const c = code.trim().toUpperCase();
    if (!c) return null;
    return (
      parts.find((p) => p.partNumber.toUpperCase() === c) ||
      parts.find((p) => (p.mpn ?? "").toUpperCase() === c) ||
      (c.length >= 5 ? parts.find((p) => (p.mpn ?? "").toUpperCase().includes(c)) : undefined) ||
      null
    );
  }

  function select(p: Part) {
    setSelected(p);
    setCount(String(p.onHand));
    setMsg(null);
    setQuery("");
  }

  // Cross-browser camera scanning via ZXing (works on iOS Safari, Android, desktop).
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;
    let controls: { stop: () => void } | null = null;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        if (!videoRef.current || cancelled) return;
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (!result) return;
            const text = result.getText();
            const p = findByCode(text);
            controls?.stop();
            setScanning(false);
            if (p) select(p);
            else {
              setQuery(text);
              setMsg({ text: `No part matched "${text}". Search or type it in.`, ok: false });
            }
          },
        );
      } catch {
        if (!cancelled) {
          setMsg({ text: "Couldn't start the camera. Allow camera access, or search manually below.", ok: false });
          setScanning(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  async function submit() {
    if (!selected) return;
    const n = Number(count);
    if (!Number.isFinite(n) || n < 0) {
      setMsg({ text: "Enter a valid count.", ok: false });
      return;
    }
    setSaving(true);
    const from = selected.onHand;
    const res = await setStockCount(selected.id, n);
    setSaving(false);
    if (res.ok && res.onHand != null) {
      setParts((ps) => ps.map((p) => (p.id === selected.id ? { ...p, onHand: res.onHand! } : p)));
      setLog((l) => [{ partNumber: selected.partNumber, from, to: res.onHand! }, ...l].slice(0, 50));
      setMsg({ text: `${selected.partNumber}: on-hand set to ${fmtNum(res.onHand)}.`, ok: true });
      setSelected(null);
      setCount("");
    } else {
      setMsg({ text: res.error ?? "Failed to save.", ok: false });
    }
  }

  const q = query.trim().toLowerCase();
  const matches =
    q.length === 0
      ? []
      : parts
          .filter(
            (p) =>
              p.partNumber.toLowerCase().includes(q) ||
              p.name.toLowerCase().includes(q) ||
              (p.mpn ?? "").toLowerCase().includes(q),
          )
          .slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-surface p-4">
        {scanning ? (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="h-64 w-full object-cover" playsInline muted />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-brand/70" />
            </div>
            <p className="text-center text-xs text-muted">Point the camera at the barcode.</p>
            <button onClick={() => setScanning(false)} className={`${btnGhost} w-full`}>
              Stop scanning
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button onClick={() => setScanning(true)} className={`${btnPrimary} w-full py-3 text-base`}>
              📷 Scan barcode
            </button>
            <input
              className={`${input} py-3 text-base`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="…or search part number / description / MPN"
              autoComplete="off"
            />
            {matches.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {matches.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => select(p)}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-surface-2"
                    >
                      <span>
                        <span className="font-medium text-ink">{p.partNumber}</span>
                        <span className="block max-w-[60vw] truncate text-xs text-muted">{p.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">on hand {fmtNum(p.onHand)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {selected && (
        <div className="rounded-xl border-2 border-brand/40 bg-surface p-4">
          <div className="text-lg font-semibold text-ink">{selected.partNumber}</div>
          <div className="mb-3 text-sm text-muted">{selected.name}</div>
          <div className="mb-1 text-xs text-muted">Current on hand: {fmtNum(selected.onHand)}</div>
          <label className="mb-1 block text-sm font-medium text-ink-2">Counted quantity</label>
          <input
            className={`${input} py-3 text-center text-2xl font-semibold tnum`}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            type="number"
            inputMode="numeric"
            min="0"
            autoFocus
          />
          <div className="mt-3 flex gap-2">
            <button onClick={submit} disabled={saving} className={`${btnPrimary} flex-1 py-3`}>
              {saving ? "Saving…" : "Set count"}
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setMsg(null);
              }}
              className={btnGhost}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {msg && <p className={`text-center text-sm font-medium ${msg.ok ? "text-good" : "text-critical"}`}>{msg.text}</p>}

      {log.length > 0 && (
        <div className="rounded-xl border bg-surface">
          <div className="border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
            This session ({log.length})
          </div>
          <ul className="divide-y">
            {log.map((e, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-medium text-ink">{e.partNumber}</span>
                <span className="tnum text-muted">
                  {fmtNum(e.from)} → <span className="font-semibold text-ink">{fmtNum(e.to)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
