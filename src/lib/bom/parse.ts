import * as XLSX from "xlsx";
import Papa from "papaparse";

/** A normalized part line extracted from a BOM file. */
export interface BomRow {
  partNumber: string;
  qtyPer: number;
  value?: string; // "Comment"
  name: string; // "Item Name" / description
  footprint?: string;
  manufacturer?: string;
  mpn?: string; // "Manufacturer Item 1"
}

export interface ParseResult {
  rows: BomRow[];
  warnings: string[];
  detectedHeader: Record<string, number>; // logical field -> column index
}

// Header synonyms -> logical field. Matched case-insensitively, trimmed.
const HEADER_MAP: Record<string, keyof BomRow> = {
  quantity: "qtyPer",
  qty: "qtyPer",
  "item number": "partNumber",
  "part number": "partNumber",
  "internal pn": "partNumber",
  comment: "value",
  value: "value",
  "item name": "name",
  description: "name",
  footprint: "footprint",
  "manufacturer 1": "manufacturer",
  manufacturer: "manufacturer",
  mfr: "manufacturer",
  "manufacturer item 1": "mpn",
  "mfr part": "mpn",
  mpn: "mpn",
};

/** Collapse embedded newlines/tabs/repeats and trim. */
export function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function toRows(aoa: unknown[][]): ParseResult {
  const warnings: string[] = [];
  if (!aoa.length) return { rows: [], warnings: ["File is empty."], detectedHeader: {} };

  // Find the header row: the first row containing a recognizable "item number"/"quantity" pair.
  let headerIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const cells = aoa[i].map((c) => clean(c).toLowerCase());
    if (cells.some((c) => HEADER_MAP[c] === "partNumber") && cells.some((c) => HEADER_MAP[c] === "qtyPer")) {
      headerIdx = i;
      break;
    }
  }

  const header = aoa[headerIdx].map((c) => clean(c).toLowerCase());
  const colOf: Partial<Record<keyof BomRow, number>> = {};
  header.forEach((label, idx) => {
    const field = HEADER_MAP[label];
    if (field && colOf[field] === undefined) colOf[field] = idx;
  });

  if (colOf.partNumber === undefined)
    return { rows: [], warnings: ["Could not find an 'Item Number' / 'Part Number' column."], detectedHeader: {} };
  if (colOf.qtyPer === undefined) warnings.push("No 'Quantity' column found — defaulting each line to qty 1.");
  if (colOf.name === undefined) warnings.push("No 'Item Name' / description column found.");

  const rows: BomRow[] = [];
  const seen = new Map<string, number>(); // partNumber -> row index in `rows`
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    const partNumber = clean(raw[colOf.partNumber!]);
    if (!partNumber) continue; // skip blank/spacer rows

    const qtyRaw = colOf.qtyPer !== undefined ? clean(raw[colOf.qtyPer]) : "1";
    const qtyPer = Number(qtyRaw.replace(/[^0-9.\-]/g, "")) || 0;
    if (qtyPer <= 0) warnings.push(`Row ${i + 1} (${partNumber}): quantity is "${qtyRaw}" — treated as 0.`);

    const row: BomRow = {
      partNumber,
      qtyPer,
      value: colOf.value !== undefined ? clean(raw[colOf.value]) || undefined : undefined,
      name: colOf.name !== undefined ? clean(raw[colOf.name]) : partNumber,
      footprint: colOf.footprint !== undefined ? clean(raw[colOf.footprint]) || undefined : undefined,
      manufacturer: colOf.manufacturer !== undefined ? clean(raw[colOf.manufacturer]) || undefined : undefined,
      mpn: colOf.mpn !== undefined ? clean(raw[colOf.mpn]) || undefined : undefined,
    };

    // Merge duplicate part numbers within the same file (sum quantities).
    const existingIdx = seen.get(partNumber);
    if (existingIdx !== undefined) {
      rows[existingIdx].qtyPer += qtyPer;
      warnings.push(`Duplicate part ${partNumber} in file — quantities summed.`);
    } else {
      seen.set(partNumber, rows.length);
      rows.push(row);
    }
  }

  return { rows, warnings, detectedHeader: colOf as Record<string, number> };
}

/** Parse an .xlsx/.xls workbook buffer (first sheet). */
export function parseWorkbook(buf: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  return toRows(aoa);
}

/** Parse a CSV buffer/string. */
export function parseCsv(input: string | Buffer): ParseResult {
  const text = typeof input === "string" ? input : input.toString("utf8");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: true });
  return toRows(parsed.data as unknown[][]);
}

/** Dispatch on filename extension. */
export function parseBomFile(filename: string, buf: Buffer): ParseResult {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv") return parseCsv(buf);
  return parseWorkbook(buf);
}
