import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as apns from "@mattrax/apns";
import { extractTopicFromCertPem, resetAppleTopicCache } from "../cert.js";
import { generateTestCertPem } from "./helpers.js";

describe("Apple MDM topic cache", () => {
  // Parsing is the expensive read the cache exists to avoid, so counting the
  // real parser's calls is the requirement here. Spy on the real module rather
  // than replace it: every parse still runs the production parser.
  let parse: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAppleTopicCache();
    parse = vi.spyOn(apns, "parseCertificateMetadata");
  });

  afterEach(() => parse.mockRestore());

  it("parses one certificate once across rebuilt service instances", async () => {
    const pem = await generateTestCertPem("com.apple.mgmt.External.shared");

    expect(await extractTopicFromCertPem(pem)).toBe("com.apple.mgmt.External.shared");
    expect(await extractTopicFromCertPem(pem)).toBe("com.apple.mgmt.External.shared");
    expect(parse.mock.calls.length).toBe(1);
  });

  it("parses a rotated certificate again and returns the new topic", async () => {
    const first = await generateTestCertPem("com.apple.mgmt.External.first");
    const rotated = await generateTestCertPem("com.apple.mgmt.External.rotated");

    expect(await extractTopicFromCertPem(first)).toBe("com.apple.mgmt.External.first");
    expect(await extractTopicFromCertPem(rotated)).toBe("com.apple.mgmt.External.rotated");
    expect(parse.mock.calls.length).toBe(2);
  });

  it("keeps the CN fallback and caches invalid input", async () => {
    const pem = await generateTestCertPem("com.apple.mgmt.External.cn", false);

    expect(await extractTopicFromCertPem(pem)).toBe("com.apple.mgmt.External.cn");
    expect(await extractTopicFromCertPem("not-a-pem")).toBeNull();
    expect(await extractTopicFromCertPem("not-a-pem")).toBeNull();
    expect(parse.mock.calls.length).toBe(2);
  });
});
