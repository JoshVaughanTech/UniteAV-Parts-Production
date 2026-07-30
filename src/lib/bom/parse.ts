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

// Header synonyms per logical field, in PRIORITY order. Matched case-insensitively,
// trimmed, exact. Priority matters when a sheet carries two candidates for one field:
// some Unite AV sheets label the value column "Description" and still carry the full
// "Item Name" alongside it, so "Item Name" must win rather than whichever comes first.
const FIELD_HEADERS: { field: keyof BomRow; labels: string[] }[] = [
  { field: "qtyPer", labels: ["quantity", "qty"] },
  { field: "partNumber", labels: ["item number", "part number", "internal pn"] },
  { field: "name", labels: ["item name", "description"] },
  // "description" only reaches `value` when `name` already claimed an "Item Name" column.
  { field: "value", labels: ["comment", "value", "description"] },
  { field: "footprint", labels: ["footprint"] },
  { field: "manufacturer", labels: ["manufacturer 1", "manufacturer", "mfr"] },
  { field: "mpn", labels: ["manufacturer item 1", "mfr part", "mpn"] },
];

/** Map a header row to column indexes — first unclaimed label per field, in priority order. */
function columnsOf(header: string[]): Partial<Record<keyof BomRow, number>> {
  const colOf: Partial<Record<keyof BomRow, number>> = {};
  const claimed = new Set<number>();
  for (const { field, labels } of FIELD_HEADERS) {
    for (const label of labels) {
      const idx = header.findIndex((h, i) => h === label && !claimed.has(i));
      if (idx >= 0) {
        colOf[field] = idx;
        claimed.add(idx);
        break;
      }
    }
  }
  return colOf;
}

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
    const cols = columnsOf(aoa[i].map((c) => clean(c).toLowerCase()));
    if (cols.partNumber !== undefined && cols.qtyPer !== undefined) {
      headerIdx = i;
      break;
    }
  }

  const header = aoa[headerIdx].map((c) => clean(c).toLowerCase());
  const colOf = columnsOf(header);

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

/** Parse an .xlsx/.xls workbook buffer — picks the first sheet with an "Item Number" column. */
export function parseWorkbook(buf: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  let ws = wb.Sheets[wb.SheetNames[0]];
  for (const sn of wb.SheetNames) {
    const s = wb.Sheets[sn];
    if (!s || !s["!ref"]) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(s, { header: 1, defval: "", raw: false });
    const header = (rows[0] ?? []).map((c) => clean(c).toLowerCase());
    if (columnsOf(header).partNumber !== undefined) {
      ws = s;
      break;
    }
  }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: false });
  return toRows(aoa);
}

/**
 * Parse ONE named sheet of a workbook. Needed for multi-sheet product workbooks, where
 * each board has its own sheet and `parseWorkbook`'s "first parts-bearing sheet" rule
 * would pick the wrong one (or the chassis rollup, which has no item numbers).
 */
export function parseWorkbookSheet(buf: Buffer | ArrayBuffer, sheetName: string): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"])
    return {
      rows: [],
      warnings: [`Sheet "${sheetName}" not found or empty. Sheets present: ${wb.SheetNames.join(", ")}.`],
      detectedHeader: {},
    };
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
