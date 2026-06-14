// CSV export/import helpers that drive the native file dialog, then stream the
// data through the Rust COPY path (so it works on remote servers and never
// buffers the whole dataset in memory).
import { save, open } from "@tauri-apps/plugin-dialog";
import { api } from "@/lib/api";

const CSV_FILTER = [{ name: "CSV", extensions: ["csv"] }];

/** Prompt for a destination, then stream a whole table to CSV. Returns bytes, or null if cancelled. */
export async function exportTableToCsv(
  sessionId: string,
  schema: string,
  table: string,
): Promise<number | null> {
  const path = await save({ defaultPath: `${table}.csv`, filters: CSV_FILTER });
  if (!path) return null;
  return api.exportTableCsv(sessionId, schema, table, path);
}

/** Prompt for a destination, then stream a query's result to CSV. */
export async function exportQueryToCsv(
  sessionId: string,
  sql: string,
): Promise<number | null> {
  const path = await save({ defaultPath: "result.csv", filters: CSV_FILTER });
  if (!path) return null;
  return api.exportQueryCsv(sessionId, sql, path);
}

/** Prompt for a CSV file, then stream-load it into a table. Returns rows loaded, or null if cancelled. */
export async function importCsvIntoTable(
  sessionId: string,
  schema: string,
  table: string,
): Promise<number | null> {
  const selected = await open({ multiple: false, filters: CSV_FILTER });
  if (!selected || typeof selected !== "string") return null;
  const outcome = await api.importTableCsv(sessionId, schema, table, selected, true);
  return outcome.rows;
}
