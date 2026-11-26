import { beforeEach, describe, expect, it } from "vitest";
import { parseCertificateMetadata } from "@mattrax/apns";
import { extractTopicFromCertPem, resetAppleTopicCache } from "../cert.js";
import { generateTestCertPem } from "./helpers.js";

describe("Apple MDM topic cache", () => {
  // Parsing is the expensive read the cache exists to avoid, so counting the
  // injected parser's calls is the requirement here. The counter wraps the
  // real parser, so every parse still runs production code.
  const countingParser = () => {
    let calls = 0;

    const parse: typeof parseCertificateMetadata = async (pem) => {
      calls++;

      return parseCertificateMetadata(pem);
    };

    return { parse, count: () => calls };
  };

  beforeEach(() => resetAppleTopicCache());

  it("parses one certificate once across rebuilt service instances", async () => {
    const pem = await generateTestCertPem("com.apple.mgmt.External.shared");
    const { parse, count } = countingParser();

    expect(await extractTopicFromCertPem(pem, parse)).toBe("com.apple.mgmt.External.shared");
    expect(await extractTopicFromCertPem(pem, parse)).toBe("com.apple.mgmt.External.shared");
    expect(count()).toBe(1);
  });

  it("parses a rotated certificate again and returns the new topic", async () => {
    const first = await generateTestCertPem("com.apple.mgmt.External.first");
    const rotated = await generateTestCertPem("com.apple.mgmt.External.rotated");
    const { parse, count } = countingParser();

    expect(await extractTopicFromCertPem(first, parse)).toBe("com.apple.mgmt.External.first");
    expect(await extractTopicFromCertPem(rotated, parse)).toBe("com.apple.mgmt.External.rotated");
    expect(count()).toBe(2);
  });

  it("keeps the CN fallback and caches invalid input", async () => {
    const pem = await generateTestCertPem("com.apple.mgmt.External.cn", false);
    const { parse, count } = countingParser();

    expect(await extractTopicFromCertPem(pem, parse)).toBe("com.apple.mgmt.External.cn");
    expect(await extractTopicFromCertPem("not-a-pem", parse)).toBeNull();
    expect(await extractTopicFromCertPem("not-a-pem", parse)).toBeNull();
    expect(count()).toBe(2);
  });
});
