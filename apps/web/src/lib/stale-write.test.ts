import { describe, expect, it } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { recorder } from "../../../../packages/config/testing/recorder.ts";
import {
  createStaleWriteGuard,
  STALE_WRITE_TITLE,
  handleStaleWrite,
  isStaleWriteError,
} from "./stale-write";

const preconditionFailure = {
  _tag: "EnterprisePreconditionFailed",
  message: "This policy changed since you loaded it.",
  current: {
    id: "policy-1",
    name: "Saved elsewhere",
    updatedAt: "2026-11-20T10:15:30.123Z",
  },
};

describe("stale writes", () => {
  it("recognises a 412 domain failure, including a transport envelope", () => {
    expect(isStaleWriteError(preconditionFailure)).toBe(true);
    expect(isStaleWriteError({ _tag: "Failure", error: preconditionFailure })).toBe(true);
    expect(isStaleWriteError({ _tag: "EnterpriseBadRequest", message: "nope" })).toBe(false);
    expect(isStaleWriteError(new Error("network down"))).toBe(false);
  });

  it("toasts and refetches on 412", () => {
    const notify = recorder();
    const reload = recorder();

    expect(handleStaleWrite(preconditionFailure, { notify, reload })).toBe(true);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      STALE_WRITE_TITLE,
      expect.objectContaining({ description: expect.stringContaining("unsaved changes") }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves other failures to the caller", () => {
    const notify = recorder();
    const reload = recorder();

    expect(
      handleStaleWrite({ _tag: "EnterpriseBadRequest", message: "bad" }, { notify, reload }),
    ).toBe(false);

    expect(notify).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("stale-write guard", () => {
  const setup = (initialUpdatedAt: string) =>
    createRoot((dispose) => {
      const [updatedAt, setUpdatedAt] = createSignal(initialUpdatedAt);

      return {
        guard: createStaleWriteGuard(updatedAt),
        setUpdatedAt,
        dispose,
      };
    });

  it("advances only when a server-side refresh is acknowledged", () => {
    const { guard, setUpdatedAt, dispose } = setup("2026-11-20T10:00:00.000Z");

    try {
      expect(guard.expectedUpdatedAt()).toBe("2026-11-20T10:00:00.000Z");

      setUpdatedAt("2026-11-20T10:05:00.000Z");
      expect(guard.expectedUpdatedAt()).toBe("2026-11-20T10:00:00.000Z");

      guard.markRefreshed();
      expect(guard.expectedUpdatedAt()).toBe("2026-11-20T10:05:00.000Z");

      setUpdatedAt("2026-11-20T10:10:00.000Z");
      expect(guard.expectedUpdatedAt()).toBe("2026-11-20T10:05:00.000Z");
    } finally {
      dispose();
    }
  });

  it("keeps a forced 412 draft pinned until the latest version is accepted", () => {
    const { guard, setUpdatedAt, dispose } = setup("2026-11-20T10:00:00.000Z");

    try {
      setUpdatedAt("2026-11-20T10:05:00.000Z");
      guard.markConflict();
      guard.markRefreshed();

      expect(guard.conflict()).toBe(true);
      expect(guard.expectedUpdatedAt()).toBe("2026-11-20T10:00:00.000Z");

      setUpdatedAt("2026-11-20T10:10:00.000Z");
      expect(guard.expectedUpdatedAt()).toBe("2026-11-20T10:00:00.000Z");

      guard.acceptLatest();
      expect(guard.conflict()).toBe(false);
      expect(guard.expectedUpdatedAt()).toBe("2026-11-20T10:10:00.000Z");
    } finally {
      dispose();
    }
  });
});
