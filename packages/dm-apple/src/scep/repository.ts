import { Context, Effect } from "effect";
import { ScepError } from "../schema.js";

export class ScepRepository extends Context.Service<
  ScepRepository,
  {
    readonly getCa: () => Effect.Effect<{ certPem: string; privateKeyJwk: JsonWebKey } | null, ScepError>;
    readonly saveCa: (certPem: string, privateKeyJwk: JsonWebKey) => Effect.Effect<void, ScepError>;
  }
>()("ScepRepository") {}
