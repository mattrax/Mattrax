import { Effect } from "effect";
import { SoftwareUpdateBackground } from "@mattrax/enterprise-backend";

type WaitUntilContext = {
  readonly waitUntil: (promise: Promise<unknown>) => void;
};

/** Tie stale-while-revalidate work to the Worker invocation, not the response fiber. */
export const softwareUpdateRequestService = (ctx: WaitUntilContext) =>
  SoftwareUpdateBackground.of({
    run: (effect) => ctx.waitUntil(Effect.runPromise(effect)),
  });
