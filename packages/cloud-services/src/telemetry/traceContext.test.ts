import { describe, expect, it } from "vitest";
import { formatTraceparent, newTraceContext, parseTraceparent } from "./traceContext.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

const SPAN_ID = "00f067aa0ba902b7";

const VALID = `00-${TRACE_ID}-${SPAN_ID}-01`;

describe("parseTraceparent", () => {
  it("parses a valid version 00 header", () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      sampled: true,
    });
  });

  it("preserves an unsampled flag", () => {
    const parsed = parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`);

    expect(parsed?.sampled).toBe(false);
    expect(parsed?.traceFlags).toBe(0);
  });

  it("ignores unknown flag bits when deciding sampling", () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-fe`)?.sampled).toBe(false);
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-03`)?.sampled).toBe(true);
  });

  it("accepts a future version that appends fields", () => {
    expect(parseTraceparent(`01-${TRACE_ID}-${SPAN_ID}-01-extra-data`)?.traceId).toBe(TRACE_ID);
  });

  it("rejects a version 00 header with trailing fields", () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01-extra`)).toBeUndefined();
  });

  it("rejects invalid versions and ids", () => {
    for (const header of [
      "",
      "not-a-traceparent",
      `ff-${TRACE_ID}-${SPAN_ID}-01`,
      `${TRACE_ID}-${SPAN_ID}-01`,
      `00-${TRACE_ID}-${SPAN_ID}`,
      `00-${TRACE_ID}-${SPAN_ID}-0`,
      `00-${"0".repeat(32)}-${SPAN_ID}-01`,
      `00-${TRACE_ID}-${"0".repeat(16)}-01`,
      `00-${TRACE_ID}-${SPAN_ID}-zz`,
      `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`,
    ])
      expect(parseTraceparent(header)).toBeUndefined();
  });

  it("treats a missing header as no context", () => {
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent(null)).toBeUndefined();
  });
});

describe("formatTraceparent", () => {
  it("round-trips a parsed header", () => {
    expect(formatTraceparent(parseTraceparent(VALID)!)).toBe(VALID);
  });

  it("pads the flags to two hex digits", () => {
    const context = newTraceContext({ sampled: false });

    expect(formatTraceparent(context)).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
    expect(parseTraceparent(formatTraceparent(context))?.sampled).toBe(false);
  });
});

describe("newTraceContext", () => {
  it("generates W3C-shaped lowercase ids", () => {
    const context = newTraceContext();

    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(context.traceId).not.toBe("0".repeat(32));
    expect(newTraceContext().traceId).not.toBe(context.traceId);
  });
});
