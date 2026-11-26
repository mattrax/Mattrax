import { describe, expect, it } from "vitest";
import {
  clientAddress,
  clientDescriptor,
  hashClientAddress,
  parseUserAgent,
} from "../src/Account/accountAudit.ts";
import { runEffect } from "./helpers.js";

const agents = {
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/604.1",
  curl: "curl/8.4.0",
};

describe("client descriptor parsing", () => {
  it("names the browser family and platform without keeping the raw header", () => {
    expect(parseUserAgent(agents.macChrome)).toEqual({
      browser: "Chrome",
      platform: "macOS",
      deviceType: "desktop",
    });
    expect(parseUserAgent(agents.windowsEdge)).toEqual({
      browser: "Edge",
      platform: "Windows",
      deviceType: "desktop",
    });
    expect(parseUserAgent(agents.iphoneSafari)).toEqual({
      browser: "Safari",
      platform: "iOS",
      deviceType: "mobile",
    });
    expect(parseUserAgent(agents.androidChrome)).toEqual({
      browser: "Chrome",
      platform: "Android",
      deviceType: "mobile",
    });
    expect(parseUserAgent(agents.firefoxLinux)).toEqual({
      browser: "Firefox",
      platform: "Linux",
      deviceType: "desktop",
    });
    expect(parseUserAgent(agents.ipadSafari)).toEqual({
      browser: "Safari",
      platform: "iOS",
      deviceType: "tablet",
    });
  });

  it("classifies scripted clients as bots and tolerates a missing header", () => {
    expect(parseUserAgent(agents.curl)).toEqual({
      browser: "Bot",
      platform: null,
      deviceType: "bot",
    });
    expect(parseUserAgent(undefined)).toEqual({
      browser: null,
      platform: null,
      deviceType: null,
    });
    // The header is bounded before parsing so an oversized value cannot be
    // used to bloat a row.
    expect(parseUserAgent(`${agents.macChrome}${" ".repeat(2000)}`).browser).toBe("Chrome");
  });
});

describe("client address hashing", () => {
  it("uses only the address rebuilt by the runtime trust boundary", () => {
    expect(clientAddress({ "x-mattrax-client-address": "203.0.113.9" })).toBe("203.0.113.9");
    expect(
      clientAddress({
        "cf-connecting-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.4, 10.0.0.1",
        "x-real-ip": "192.0.2.7",
      }),
    ).toBeNull();
    expect(clientAddress({ "x-mattrax-client-address": "not-an-ip" })).toBeNull();
    expect(clientAddress({})).toBeNull();
  });

  it("stores only a salted prefix and never the address", async () => {
    const hash = await runEffect(hashClientAddress("deployment-secret", "203.0.113.9"));

    expect(hash).toMatch(/^[a-f0-9]{32}$/);
    expect(hash).not.toContain("203.0.113.9");
    // A different deployment salt yields a different digest for the same input.
    await expect(runEffect(hashClientAddress("other-secret", "203.0.113.9"))).resolves.not.toBe(
      hash,
    );
    // Without a salt nothing address-derived is persisted.
    await expect(runEffect(hashClientAddress(undefined, "203.0.113.9"))).resolves.toBeNull();
  });

  it("combines the parsed agent with the addressed digest", async () => {
    const descriptor = await runEffect(
      clientDescriptor(
        { "user-agent": agents.macChrome, "x-mattrax-client-address": "203.0.113.9" },
        "deployment-secret",
      ),
    );

    expect(descriptor).toMatchObject({
      browser: "Chrome",
      platform: "macOS",
      deviceType: "desktop",
    });
    expect(descriptor.ipHash).toMatch(/^[a-f0-9]{32}$/);
  });
});
