import { describe, expect, it } from "vitest";
import { postHogEnvironment } from "./posthog-config-store";

describe("PostHog environment classification", () => {
  it("separates local development, previews and production", () => {
    expect(postHogEnvironment("localhost")).toBe("development");
    expect(postHogEnvironment("127.0.0.1")).toBe("development");
    expect(postHogEnvironment("pr-42-mattrax.example.workers.dev")).toBe("preview");
    expect(postHogEnvironment("e.mattrax.app")).toBe("production");
    expect(postHogEnvironment("devices.example.com")).toBe("production");
  });
});
