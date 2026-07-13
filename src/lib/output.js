// Result rendering + delivery. Formats an array of row objects as a table, CSV,
// or JSON, and writes to a file or stdout. Kept free of any command/HubSpot
// specifics so it can be reused by every subcommand.
import { writeFile } from 'node:fs/promises';

// columns: [{ key, header }]. rows: [{ [key]: value }].
export function formatRows(rows, columns, format) {
  switch (format) {
    case 'json':
      return toJSON(rows);
    case 'csv':
      return toCSV(rows, columns);
    case 'table':
      return toTable(rows, columns);
    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

export function isValidFormat(format) {
  return format === 'table' || format === 'csv' || format === 'json';
}

// Deliver rendered output either to a file or stdout. Returns a short human
// summary of where it went (for logging to stderr).
export async function deliver(text, { outputPath } = {}) {
  if (outputPath) {
    await writeFile(outputPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    return `written to ${outputPath}`;
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  return 'printed to stdout';
}

function cell(value) {
  if (value == null) return '';
  return String(value);
}

function toJSON(rows) {
  // Emit the row objects as-is (callers pass full structured records for JSON,
  // which may include more fields than the table/csv display columns).
  return JSON.stringify(rows, null, 2);
}

function toCSV(rows, columns) {
  const esc = (v) => {
    const s = cell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => esc(row[c.key])).join(','));
  }
  return lines.join('\n');
}

function toTable(rows, columns) {
  if (rows.length === 0) return '(no rows)';
  const widths = columns.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => cell(r[c.key]).length)),
  );
  const pad = (s, w) => s + ' '.repeat(w - s.length);
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const header = columns.map((c, i) => pad(c.header, widths[i])).join(' | ');
  const body = rows.map((r) =>
    columns.map((c, i) => pad(cell(r[c.key]), widths[i])).join(' | '),
  );
  return [header, sep, ...body].join('\n');
}
