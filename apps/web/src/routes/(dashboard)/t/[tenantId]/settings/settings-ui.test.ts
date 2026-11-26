import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8");

const mutationSource = (contents: string, start: string, end: string) => {
  const from = contents.indexOf(start);
  const to = contents.indexOf(end, from + start.length);

  expect(from, `Missing ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `Missing ${end}`).toBeGreaterThan(from);

  return contents.slice(from, to);
};

describe("settings UI contracts", () => {
  it("persistently labels the attribute CSV file input", () => {
    const attributes = source("attributes.tsx");

    expect(attributes).toMatch(
      /<label[^>]+for="attribute-csv-file"[^>]*>\s*Import device values CSV\s*<\/label>/,
    );
    expect(attributes).toMatch(/<input[^>]+id="attribute-csv-file"[^>]+type="file"/);
  });

  it("keeps attribute save and import failures on their inline error surfaces", () => {
    const attributes = source("attributes.tsx");
    const save = mutationSource(
      attributes,
      "const save = useMutation",
      "const remove = useMutation",
    );
    const importValues = mutationSource(
      attributes,
      "const importValues = useMutation",
      "const readCsvFile",
    );

    expect(save).toContain("meta: { inlineError: true }");
    expect(importValues).toContain("meta: { inlineError: true }");
  });

  it("leaves Approvals and Audit log with only the shared page heading", () => {
    const approvals = source("approvals.tsx");
    const audit = source("audit.tsx");

    expect(approvals).not.toContain("<PageHeader");
    expect(approvals).not.toContain('title="Approvals"');
    expect(audit).not.toContain('title="Audit log"');
  });

  it("places the masthead in the same grid column as the settings content", () => {
    const layout = source("../settings.tsx");
    const masthead = layout.slice(
      layout.indexOf('data-slot="settings-masthead"'),
      layout.indexOf('data-slot="settings-navigation"'),
    );
    const navigation = layout.slice(
      layout.indexOf('data-slot="settings-navigation"'),
      layout.indexOf('data-slot="settings-content"'),
    );
    const content = layout.slice(layout.indexOf('data-slot="settings-content"'));

    // Grid tracks are declared as custom properties and consumed through
    // custom-property utilities, so they are no longer literal arbitrary
    // values in the class list.
    expect(layout).toContain('"--settings-cols": "minmax(0, 1fr)"');
    expect(layout).toContain('"--settings-rows": "auto auto minmax(0, 1fr)"');
    expect(layout).toContain('"--settings-xl-cols": "248px minmax(0, 1fr)"');
    expect(layout).toContain('"--settings-xl-rows": "auto minmax(0, 1fr)"');
    expect(layout).toContain("grid-cols-(--settings-cols)");
    expect(layout).toContain("grid-rows-(--settings-rows)");
    expect(layout).toContain("xl:grid-cols-(--settings-xl-cols)");
    expect(layout).toContain("xl:grid-rows-(--settings-xl-rows)");

    // Small screens stack masthead, nav and content in the single column.
    expect(masthead).toContain("row-start-1");
    expect(navigation).toContain("row-start-2");
    expect(content).toContain("row-start-3");

    // At xl the rail owns column 1 across both rows, while the masthead and
    // content share column 2 — the same layout contract as the old grid areas.
    expect(navigation).toContain("xl:col-start-1");
    expect(navigation).toContain("xl:row-start-1");
    expect(navigation).toContain("xl:row-span-2");
    expect(masthead).toContain("xl:col-start-2");
    expect(masthead).toContain("xl:row-start-1");
    expect(content).toContain("xl:col-start-2");
    expect(content).toContain("xl:row-start-2");
  });
});
