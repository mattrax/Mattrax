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
    const content = layout.slice(layout.indexOf('data-slot="settings-content"'));

    expect(layout).toContain("[grid-template-areas:'masthead'_'nav'_'content']");
    expect(layout).toContain("xl:[grid-template-areas:'nav_masthead'_'nav_content']");
    expect(layout).toContain("grid-rows-[auto_auto_minmax(0,1fr)]");
    expect(layout).toContain("xl:grid-cols-[248px_minmax(0,1fr)]");
    expect(layout).toContain("xl:grid-rows-[auto_minmax(0,1fr)]");
    expect(masthead).toContain("[grid-area:masthead]");
    expect(content).toContain("[grid-area:content]");
  });
});
