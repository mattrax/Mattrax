import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICES_URL, servicesUrls } from "./services.js";

describe("hosted services URLs", () => {
  it("defaults to the hosted services deployment", () => {
    expect(servicesUrls()).toEqual({
      origin: DEFAULT_SERVICES_URL,
      apnsRelay: "https://services.mattrax.app/v1/apns/push",
      billing: DEFAULT_SERVICES_URL,
    });
    expect(servicesUrls("")).toEqual(servicesUrls());
    expect(servicesUrls("   ")).toEqual(servicesUrls());
  });

  it("normalises a trailing slash", () => {
    expect(servicesUrls("https://services.example.com/")).toEqual({
      origin: "https://services.example.com",
      apnsRelay: "https://services.example.com/v1/apns/push",
      billing: "https://services.example.com",
    });
  });

  it("derives every endpoint from an override", () => {
    expect(servicesUrls("https://services.example.com")).toEqual({
      origin: "https://services.example.com",
      apnsRelay: "https://services.example.com/v1/apns/push",
      billing: "https://services.example.com",
    });
  });

  it("rejects a value that is not an http(s) URL", () => {
    expect(() => servicesUrls("not a URL")).toThrow("MATTRAX_SERVICES_URL must be an http(s) URL");
    expect(() => servicesUrls("ftp://services.example.com")).toThrow(
      "MATTRAX_SERVICES_URL must be an http(s) URL",
    );
  });
});
