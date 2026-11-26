import { beforeEach, describe, expect, it, vi } from "vitest";

const parseState = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@mattrax/apns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mattrax/apns")>();

  return {
    ...actual,
    parseCertificateMetadata: async (pem: string) => {
      parseState.calls++;

      return actual.parseCertificateMetadata(pem);
    },
  };
});

import { extractTopicFromCertPem, resetAppleTopicCache } from "../cert.js";
import { generateTestCertPem } from "./helpers.js";

describe("Apple MDM topic cache", () => {
  beforeEach(() => {
    parseState.calls = 0;
    resetAppleTopicCache();
  });

  it("parses one certificate once across rebuilt service instances", async () => {
    const pem = await generateTestCertPem("com.apple.mgmt.External.shared");

    expect(await extractTopicFromCertPem(pem)).toBe("com.apple.mgmt.External.shared");
    expect(await extractTopicFromCertPem(pem)).toBe("com.apple.mgmt.External.shared");
    expect(parseState.calls).toBe(1);
  });

  it("parses a rotated certificate again and returns the new topic", async () => {
    const first = await generateTestCertPem("com.apple.mgmt.External.first");
    const rotated = await generateTestCertPem("com.apple.mgmt.External.rotated");

    expect(await extractTopicFromCertPem(first)).toBe("com.apple.mgmt.External.first");
    expect(await extractTopicFromCertPem(rotated)).toBe("com.apple.mgmt.External.rotated");
    expect(parseState.calls).toBe(2);
  });

  it("keeps the CN fallback and caches invalid input", async () => {
    const pem = await generateTestCertPem("com.apple.mgmt.External.cn", false);

    expect(await extractTopicFromCertPem(pem)).toBe("com.apple.mgmt.External.cn");
    expect(await extractTopicFromCertPem("not-a-pem")).toBeNull();
    expect(await extractTopicFromCertPem("not-a-pem")).toBeNull();
    expect(parseState.calls).toBe(2);
  });
});
