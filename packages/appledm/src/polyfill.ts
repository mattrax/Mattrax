import { Context, Effect, Layer } from "effect";
import { MdmError } from "./schema.js";

export class DeclarationPolyfill extends Context.Service<
  DeclarationPolyfill,
  {
    readonly reconcileDevice: (deviceId: string) => Effect.Effect<void, MdmError>;
  }
>()("DeclarationPolyfill") {}

export const DeclarationPolyfillLive = Layer.succeed(
  DeclarationPolyfill,
  DeclarationPolyfill.of({
    reconcileDevice: () => Effect.void,
  }),
);
