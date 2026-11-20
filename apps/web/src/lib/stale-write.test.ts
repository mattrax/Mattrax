import { describe, expect, it, vi } from "vitest";
import { STALE_WRITE_TITLE, handleStaleWrite, isStaleWriteError } from "./stale-write";

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
    const notify = vi.fn();
    const reload = vi.fn();

    expect(handleStaleWrite(preconditionFailure, { notify, reload })).toBe(true);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      STALE_WRITE_TITLE,
      expect.objectContaining({ description: expect.stringContaining("unsaved changes") }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves other failures to the caller", () => {
    const notify = vi.fn();
    const reload = vi.fn();

    expect(
      handleStaleWrite({ _tag: "EnterpriseBadRequest", message: "bad" }, { notify, reload }),
    ).toBe(false);

    expect(notify).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
