import { afterEach, describe, expect, it } from "vitest";
import { installGlobal } from "../../../../../packages/config/testing/globals.ts";
import { Option } from "effect";
import { readTableColumnVisibility } from "~/lib/table-column-visibility";
import { decodePolicyConfiguration } from "~/lib/policy-config";

let restoreGlobals = () => {};

afterEach(() => {
  restoreGlobals();
  restoreGlobals = () => {};
});

const store = (value: string | null) => {
  restoreGlobals = installGlobal("localStorage", {
    getItem: () => value,
  });
};

describe("persisted table state", () => {
  it.each(["null", "true", "[]", '"name"', '{"name":null}', '{"name":"yes"}'])(
    "falls back safely for %s",
    (raw) => {
      store(raw);
      expect(readTableColumnVisibility("columns")).toEqual({});
    },
  );

  it("keeps a boolean record", () => {
    store('{"name":false,"serial":true}');
    expect(readTableColumnVisibility("columns")).toEqual({ name: false, serial: true });
  });
});

describe("policy configuration decoding", () => {
  const decode = decodePolicyConfiguration;

  it.each(["null", "true", "[]", '"name"'])("rejects non-record state %s", (raw) => {
    expect(Option.isNone(decode(JSON.parse(raw)))).toBe(true);
  });

  it("accepts JSON-valued configuration records", () => {
    expect(Option.isSome(decode({ restriction: true, payload: { nested: [1, null] } }))).toBe(true);
  });
});
