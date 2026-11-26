import { describe, expect, it, vi } from "vitest";
import { createBackgroundTasks } from "./backgroundTasks.ts";
import { parseCron, startCronScheduler } from "./cron.ts";

describe("cron", () => {
  it("evaluates expressions in UTC, like the platform", () => {
    const daily = parseCron("17 3 * * *");

    expect(daily(new Date("2026-01-01T03:17:00Z"))).toBe(true);
    expect(daily(new Date("2026-01-01T04:17:00Z"))).toBe(false);
  });

  it("matches Sunday as day 0", () => {
    // 2026-01-04 is a Sunday.
    expect(parseCron("0 9 * * 0")(new Date("2026-01-04T09:00:00Z"))).toBe(true);
    expect(parseCron("0 9 * * 1")(new Date("2026-01-04T09:00:00Z"))).toBe(false);
  });

  it("accepts the Cloudflare daily and hourly triggers", () => {
    expect(parseCron("17 3 * * *")(new Date("2026-11-16T03:17:00Z"))).toBe(true);
    expect(parseCron("47 * * * *")(new Date("2026-11-16T14:47:00Z"))).toBe(true);
  });

  it("keeps the running guard until triggered background work finishes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));

    try {
      let calls = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const stop = startCronScheduler({
        expressions: ["* * * * *"],
        trigger: () => {
          calls += 1;
          return gate;
        },
        log: () => {},
      });

      await vi.advanceTimersByTimeAsync(15_000);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(1);

      let idle = false;
      const waiting = stop.idle().then(() => {
        idle = true;
      });
      await Promise.resolve();
      expect(idle).toBe(false);

      release();
      await waiting;
      vi.setSystemTime(new Date("2026-11-24T12:01:45Z"));
      await vi.advanceTimersByTimeAsync(15_000);
      expect(calls).toBe(2);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let unrelated request work hold the cron overlap guard", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
    const processTasks = createBackgroundTasks();
    let releaseAnalytics!: () => void;
    processTasks.waitUntil(
      new Promise<void>((resolve) => {
        releaseAnalytics = resolve;
      }),
    );
    let calls = 0;
    const stop = startCronScheduler({
      expressions: ["* * * * *"],
      trigger: async () => {
        const tickTasks = processTasks.fork();
        calls += 1;
        tickTasks.waitUntil(Promise.resolve());
        await tickTasks.idle();
      },
      log: () => {},
    });

    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(calls).toBe(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(2);
      stop();
      await stop.idle();
    } finally {
      stop();
      releaseAnalytics();
      await processTasks.idle();
      vi.useRealTimers();
    }
  });
});
