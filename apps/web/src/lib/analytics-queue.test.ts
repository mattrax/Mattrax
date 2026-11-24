import { describe, expect, it, vi } from "vitest";
import { AnalyticsQueue, AnalyticsStorageQueue } from "./analytics-queue";

const controlledClock = () => {
  let run: (() => void) | undefined;
  const cancel = vi.fn();

  return {
    schedule: (next: () => void) => {
      run = next;

      return cancel;
    },
    fire: () => run?.(),
    cancel,
  };
};

describe("AnalyticsStorageQueue", () => {
  it("coalesces rapid snapshots into one write of the latest value", () => {
    const clock = controlledClock();
    const persist = vi.fn();
    const queue = new AnalyticsStorageQueue<number>({
      delay: 5_000,
      persist,
      schedule: clock.schedule,
    });

    queue.set(1);
    queue.set(2);
    queue.set(3);

    expect(persist).not.toHaveBeenCalled();
    expect(clock.cancel).not.toHaveBeenCalled();
    clock.fire();
    expect(persist).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("flushes the latest snapshot on demand and starts a fresh window", () => {
    const clock = controlledClock();
    const persist = vi.fn();
    const queue = new AnalyticsStorageQueue<string>({
      delay: 5_000,
      persist,
      schedule: clock.schedule,
    });

    queue.set("first");
    queue.set("latest");
    queue.flush();
    queue.flush();

    expect(persist).toHaveBeenCalledExactlyOnceWith("latest");
    expect(clock.cancel).toHaveBeenCalledOnce();

    queue.set("next-window");
    clock.fire();
    expect(persist.mock.calls.map(([value]) => value)).toEqual(["latest", "next-window"]);
  });

  it("does not lose a pending snapshot when disposed", () => {
    const clock = controlledClock();
    const persist = vi.fn();
    const queue = new AnalyticsStorageQueue<number>({
      delay: 5_000,
      persist,
      schedule: clock.schedule,
    });

    queue.set(7);
    queue.dispose();
    queue.set(8);
    clock.fire();

    expect(persist).toHaveBeenCalledExactlyOnceWith(7);
  });
});

describe("AnalyticsQueue", () => {
  it("serializes flushes and schedules events queued during a send", async () => {
    const clock = controlledClock();
    let finish: (() => void) | undefined;
    const send = vi.fn(
      (_batch: ReadonlyArray<number>) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const queue = new AnalyticsQueue<number>({ delay: 100, send, schedule: clock.schedule });

    queue.push(1);
    clock.fire();
    queue.push(2);
    const first = queue.flush();
    const duplicate = queue.flush();

    expect(send).toHaveBeenCalledTimes(1);
    expect(duplicate).toBe(first);
    finish?.();
    await first;
    clock.fire();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual([2]);
    finish?.();
    await queue.flush();
  });

  it("requeues a failed batch instead of dropping it", async () => {
    const clock = controlledClock();
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const queue = new AnalyticsQueue<string>({ delay: 100, send, schedule: clock.schedule });

    queue.push("pageview");
    clock.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.size).toBe(1);

    clock.fire();
    await Promise.resolve();
    expect(send.mock.calls[1]?.[0]).toEqual(["pageview"]);
  });

  it("cancels its timer and discards pending work on dispose", () => {
    const clock = controlledClock();
    const queue = new AnalyticsQueue<number>({
      delay: 100,
      send: async () => {},
      schedule: clock.schedule,
    });

    queue.push(1);
    queue.dispose();
    clock.fire();

    expect(clock.cancel).toHaveBeenCalledOnce();
    expect(queue.size).toBe(0);
  });
});
