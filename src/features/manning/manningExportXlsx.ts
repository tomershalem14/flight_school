/** Minimal valid `.xlsx` (placeholder until export contents are defined). */
export async function buildEmptyManningWorkbookBytes(): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[""]]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  return Uint8Array.from(raw as number[]);
}
