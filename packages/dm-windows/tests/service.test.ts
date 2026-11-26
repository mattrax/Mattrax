import { describe, expect, it } from "vitest";
import { Cause, Effect, Layer } from "effect";
import { WindowsMdmService, WindowsMdmServiceLive, retryingLazyImport } from "../src/service.js";
import { mockManagementBackend } from "./helpers.js";

describe("Windows lazy implementation loading", () => {
  it("shares an in-flight import and retries after a rejected import", async () => {
    let calls = 0;
    const load = retryingLazyImport(async () => {
      calls++;

      if (calls === 1) throw new Error("transient chunk failure");

      return "implementation";
    });

    await expect(load()).rejects.toThrow("transient chunk failure");
    await expect(Promise.all([load(), load()])).resolves.toEqual([
      "implementation",
      "implementation",
    ]);
    expect(calls).toBe(2);
  });
});

describe("Windows interrupt boundaries", () => {
  it("does not swallow an interrupted best-effort device event", async () => {
    const program = Effect.gen(function* () {
      const implementation = yield* WindowsMdmService;

      return yield* implementation
        .management(
          '<SyncML xmlns="SYNCML:SYNCML1.2"><SyncHdr><VerDTD>1.2</VerDTD><VerProto>DM/1.2</VerProto><SessionID>1</SessionID><MsgID>1</MsgID><Target><LocURI>server</LocURI></Target><Source><LocURI>device-1</LocURI></Source></SyncHdr><SyncBody><Final/></SyncBody></SyncML>',
        )
        .pipe(Effect.exit);
    }).pipe(
      Effect.provide(
        WindowsMdmServiceLive({ origin: "https://test.mattrax.app" }).pipe(
          Layer.provide(
            mockManagementBackend({
              windowsManagementCheckin: () => Effect.succeed({ commands: [] }),
              windowsDeviceEvent: () => Effect.failCause(Cause.interrupt(123)),
            }),
          ),
        ),
      ),
    );
    const result = await Effect.runPromise(program);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(Cause.hasInterrupts(result.cause)).toBe(true);
  });
});
