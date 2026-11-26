import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelStepUp,
  completeStepUp,
  forgetStepUpGrants,
  pendingStepUp,
  requestStepUp,
} from "./step-up-bus";

describe("step-up bus", () => {
  beforeEach(() => {
    cancelStepUp();
    forgetStepUpGrants();
  });

  it("rejects every waiter when a native passkey ceremony is cancelled", async () => {
    const first = requestStepUp("backup-pin", ["passkey"]);
    const second = requestStepUp("backup-pin", ["passkey"]);
    const settled = Promise.allSettled([first, second]);
    const cancellation = new Error("Passkey confirmation cancelled.");

    expect(pendingStepUp()?.action).toBe("backup-pin");
    cancelStepUp(cancellation);

    const results = await settled;

    expect(results).toEqual([
      { status: "rejected", reason: cancellation },
      { status: "rejected", reason: cancellation },
    ]);
    expect(pendingStepUp()).toBeNull();
  });

  it("can open a fresh request after cancellation", async () => {
    const cancelled = requestStepUp("backup-pin", ["passkey"]);
    const settled = Promise.allSettled([cancelled]);

    cancelStepUp();
    await settled;

    const retried = requestStepUp("backup-pin", ["passkey"]);

    expect(pendingStepUp()?.action).toBe("backup-pin");
    completeStepUp("grant-1");
    await expect(retried).resolves.toBe("grant-1");
  });

  it("resolves concurrent waiters with one completed grant", async () => {
    const first = requestStepUp("backup-pin", ["passkey"]);
    const second = requestStepUp("backup-pin", ["passkey"]);

    completeStepUp("grant-1");

    await expect(Promise.all([first, second])).resolves.toEqual(["grant-1", "grant-1"]);
    expect(pendingStepUp()).toBeNull();
  });
});
