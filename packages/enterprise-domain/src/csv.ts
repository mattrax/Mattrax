/**
 * Minimal RFC 4180 reader used by CSV imports.
 *
 * Quoted fields, escaped quotes and embedded newlines are supported; a UTF-8
 * byte-order mark is stripped. Blank records are dropped so trailing newlines
 * do not become empty rows. The dashboard has its own copy for pre-registration
 * import; this one lives in the domain package so backend imports share it.
 */
export const parseCsvRecords = (input: string): string[][] => {
  const text = input.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;

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
