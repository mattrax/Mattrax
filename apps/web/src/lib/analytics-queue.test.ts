import { describe, expect, it, vi } from "vitest";
import { AnalyticsQueue } from "./analytics-queue";

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
