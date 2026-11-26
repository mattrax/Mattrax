import type { Sessions } from "@yielded/auth";
import { Passkey } from "@yielded/auth";
import { Context, Schema } from "effect";
import type { Effect } from "effect";
import type { StepUpMethods, StepUpUnavailable } from "./stepUp.ts";

/**
 * Server-side result of starting a step-up ceremony. The runtime keeps the
 * challenge in the passkey flow table; the caller signs these fields into the
 * token it hands back to the browser.
 */
export const StepUpPasskeyChallenge = Schema.Struct({
  flowId: Schema.String,
  requestBindingVerifier: Schema.String,
  requestBindingExpiresAtMillis: Schema.Int,
  expiresAtMillis: Schema.Int,
  options: Passkey.PasskeyAuthenticationOptions,
});

export type StepUpPasskeyChallenge = typeof StepUpPasskeyChallenge.Type;

/**
 * Factor verification owned by the auth runtime. It is implemented beside the
 * auth Layers because password, TOTP and passkey storage are private to them.
 * It never issues a grant: that is a pure signature over the verified result.
 */
export class StepUpService extends Context.Service<
  StepUpService,
  {
    readonly methods: (subjectId: string) => Effect.Effect<StepUpMethods, StepUpUnavailable>;
    readonly verifyTotp: (
      subjectId: string,
      code: string,
    ) => Effect.Effect<boolean, StepUpUnavailable>;
    readonly beginPasskey: (
      subjectId: string,
    ) => Effect.Effect<StepUpPasskeyChallenge, StepUpUnavailable>;
    readonly completePasskey: (input: {
      readonly subjectId: string;
      readonly flowId: string;
      readonly requestBindingVerifier: string;
      readonly requestBindingExpiresAtMillis: number;
      readonly response: string;
    }) => Effect.Effect<string | undefined, StepUpUnavailable>;
  }
>()("@mattrax/enterprise-domain/StepUpService") {}

/** Session-level assurance shape used when a grant is treated as fresh evidence. */
export const stepUpEvidenceRequirement = (): Sessions.AuthenticationRequirement => ({
  alternatives: [
    {
      factors: ["knowledge", "possession"],
      userVerified: false,
      phishingResistant: false,
      minimumCredentials: 2,
    },
    {
      factors: ["possession"],
      userVerified: true,
      phishingResistant: true,
      minimumCredentials: 1,
    },
  ],
  maximumAgeMillis: 24 * 60 * 60 * 1000,
});
