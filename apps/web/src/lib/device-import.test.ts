import { describe, expect, it } from "vitest";
import { parseDeviceImportCsv, toDeviceImportPayload } from "./device-import";

describe("device pre-registration CSV", () => {
  it("parses headers, quoted commas and CRLF line endings", () => {
    const csv =
      '\uFEFFserial,name,asset_tag,group,notes\r\nC02A,"Mac, Alice",AT-1,Staff,"Line one\r\nLine two"\r\nC02B,Bob,,,';

    const parsed = parseDeviceImportCsv(csv);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        row: 2,
        serial: "C02A",
        name: "Mac, Alice",
        assetTag: "AT-1",
        groupName: "Staff",
        notes: "Line one\r\nLine two",
      },
      { row: 3, serial: "C02B", name: "Bob" },
    ]);
    expect(toDeviceImportPayload(parsed.rows)[0]).toEqual({
      serial: "C02A",
      name: "Mac, Alice",
      assetTag: "AT-1",
      notes: "Line one\r\nLine two",
      groupName: "Staff",
    });
  });

  it("accepts header aliases and case-insensitive names", () => {
    const parsed = parseDeviceImportCsv(
      "Serial Number,Device Name,Asset Tag,Group Name,Note\nS1,Mac,AT,Staff,Hello",
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      serial: "S1",
      name: "Mac",
      assetTag: "AT",
      groupName: "Staff",
      notes: "Hello",
    });
  });

  it("rejects a missing serial column", () => {
    const parsed = parseDeviceImportCsv("name,asset_tag\nMac,AT");
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues[0]?.message).toMatch(/serial/i);
  });

  it("reports blank and duplicate serials without dropping valid rows", () => {
    const parsed = parseDeviceImportCsv("serial,name\nS1,First\n,Missing\ns1,Duplicate\nS2,Second");
    expect(parsed.rows.map((row) => row.serial)).toEqual(["S1", "S2"]);
    expect(parsed.issues).toEqual([
      { row: 3, message: "Serial is required." },
      { row: 4, message: 'Duplicate serial "s1" in this file.' },
    ]);
  });

  it("rejects an empty file", () => {
    expect(parseDeviceImportCsv("").issues[0]?.message).toMatch(/empty/i);
  });

  it("enforces the 1000-row import limit", () => {
    const rows = Array.from({ length: 1001 }, (_, index) => `S${index}`).join("\n");
    const parsed = parseDeviceImportCsv(`serial\n${rows}`);
    expect(parsed.rows).toHaveLength(1001);
    expect(parsed.issues[0]?.message).toMatch(/at most 1000/i);
  });
});
