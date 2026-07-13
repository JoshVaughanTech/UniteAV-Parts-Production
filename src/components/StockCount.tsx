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

// Minimal typing for the browser's BarcodeDetector (not in the TS DOM lib).
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorInstance;
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
  const [scanSupported, setScanSupported] = useState(true);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    setScanSupported("BarcodeDetector" in window);
    return () => stopScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function stopScan() {
    scanningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }

  async function startScan() {
    const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setScanSupported(false);
      setMsg({ text: "Barcode scanning isn't supported on this browser — search by part number instead.", ok: false });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new Ctor({
        formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "qr_code", "data_matrix", "itf"],
      });
      scanningRef.current = true;
      setScanning(true);
      setMsg(null);
      const tick = async () => {
        if (!scanningRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length) {
            const val = codes[0].rawValue;
            const p = findByCode(val);
            stopScan();
            if (p) select(p);
            else {
              setQuery(val);
              setMsg({ text: `No part matched "${val}". Search or type it manually.`, ok: false });
            }
            return;
          }
        } catch {
          /* keep scanning */
        }
        timerRef.current = setTimeout(tick, 250);
      };
      timerRef.current = setTimeout(tick, 250);
    } catch {
      stopScan();
      setMsg({ text: "Couldn't access the camera. Check permissions, or search manually.", ok: false });
    }
  }

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
      {/* Scan / search */}
      <div className="rounded-xl border bg-surface p-4">
        {scanning ? (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-lg bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video ref={videoRef} className="h-64 w-full object-cover" playsInline muted />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-brand/70" />
            </div>
            <button onClick={stopScan} className={`${btnGhost} w-full`}>
              Stop scanning
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {scanSupported && (
              <button onClick={startScan} className={`${btnPrimary} w-full py-3 text-base`}>
                📷 Scan barcode
              </button>
            )}
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
                    <button onClick={() => select(p)} className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-surface-2">
                      <span>
                        <span className="font-medium text-ink">{p.partNumber}</span>
                        <span className="block max-w-[60vw] truncate text-xs text-muted">{p.name}</span>
                      </span>
                      <span className="text-xs text-muted">on hand {fmtNum(p.onHand)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Selected part → enter count */}
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

      {msg && (
        <p className={`text-center text-sm font-medium ${msg.ok ? "text-good" : "text-critical"}`}>{msg.text}</p>
      )}

      {/* Session log */}
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
