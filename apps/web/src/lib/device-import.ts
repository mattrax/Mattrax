export const DEVICE_IMPORT_MAX_ROWS = 1000;

export type DeviceImportRow = {
  /** 1-based CSV record number (the header is record 1). */
  readonly row: number;
  readonly serial: string;
  readonly name?: string;
  readonly assetTag?: string;
  readonly notes?: string;
  readonly groupName?: string;
};

export type DeviceImportIssue = {
  readonly row: number;
  readonly message: string;
};

export type DeviceImportParseResult = {
  readonly rows: ReadonlyArray<DeviceImportRow>;
  readonly issues: ReadonlyArray<DeviceImportIssue>;
  readonly headers: ReadonlyArray<string>;
};

/** RFC 4180-style CSV reader: quoted fields, escaped quotes and embedded newlines. */
export const parseCsvRecords = (input: string): string[][] => {
  const text = input.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n") {
      record.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    records.push(record);
  }

  return records.filter((row) => row.some((cell) => cell.trim() !== ""));
};

const normalizeHeader = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, "_");

const ALIASES = new Map<string, "serial" | "name" | "asset_tag" | "group" | "notes">([
  ["serial", "serial"],
  ["serial_number", "serial"],
  ["serialnumber", "serial"],
  ["name", "name"],
  ["device_name", "name"],
  ["asset_tag", "asset_tag"],
  ["assettag", "asset_tag"],
  ["asset", "asset_tag"],
  ["group", "group"],
  ["group_name", "group"],
  ["groupname", "group"],
  ["notes", "notes"],
  ["note", "notes"],
]);

const optional = (value: string | undefined) => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
};

/**
 * Parse the dashboard's device pre-registration CSV. Invalid rows are returned
 * as issues instead of being dropped, so the preview can show exactly what is
 * wrong before anything is sent to the server.
 */
export const parseDeviceImportCsv = (input: string): DeviceImportParseResult => {
  const records = parseCsvRecords(input);

  if (records.length === 0)
    return { rows: [], issues: [{ row: 1, message: "The file is empty." }], headers: [] };

  const rawHeaders = records[0];
  const headers = rawHeaders.map((header) => ALIASES.get(normalizeHeader(header)) ?? null);

  if (!headers.includes("serial"))
    return {
      rows: [],
      issues: [{ row: 1, message: 'The CSV needs a "serial" column.' }],
      headers: rawHeaders,
    };

  const rows: DeviceImportRow[] = [];
  const issues: DeviceImportIssue[] = [];
  const seen = new Set<string>();

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const rowNumber = index + 1;

    const value = (column: (typeof headers)[number]) => {
      const position = headers.indexOf(column);

      return position === -1 ? undefined : record[position];
    };

    const serial = value("serial")?.trim() ?? "";

    if (!serial) {
      issues.push({ row: rowNumber, message: "Serial is required." });
      continue;
    }

    if (serial.length > 255) {
      issues.push({ row: rowNumber, message: "Serial is longer than 255 characters." });
      continue;
    }

    if (seen.has(serial.toLowerCase())) {
      issues.push({ row: rowNumber, message: `Duplicate serial "${serial}" in this file.` });
      continue;
    }

    seen.add(serial.toLowerCase());

    rows.push({
      row: rowNumber,
      serial,
      name: optional(value("name")),
      assetTag: optional(value("asset_tag")),
      notes: optional(value("notes")),
      groupName: optional(value("group")),
    });
  }

  if (rows.length > DEVICE_IMPORT_MAX_ROWS)
    issues.push({
      row: 1,
      message: `Import at most ${DEVICE_IMPORT_MAX_ROWS} devices at a time (found ${rows.length}).`,
    });

  return { rows, issues, headers: rawHeaders };
};

/** Convert parsed rows into the API payload (drops the local row number). */
export const toDeviceImportPayload = (rows: ReadonlyArray<DeviceImportRow>) =>
  rows.map((row) => ({
    serial: row.serial,
    name: row.name,
    assetTag: row.assetTag,
    notes: row.notes,
    groupName: row.groupName,
  }));
