import type { AnyAuthContract } from "@yielded/auth/AuthContract";
import {
  Auth,
  AuthContract,
  Password,
  Proofs,
  Schema as AuthSchema,
  Sessions,
} from "@yielded/auth";
import { Schema } from "effect";

/**
 * Public session claims. Authoritative user and organization data is still read
 * from the application database by the `/me` and tenant endpoints.
 */
export const AuthClaims = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
});
export type AuthClaims = typeof AuthClaims.Type;

export const Registration = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
});
export type Registration = typeof Registration.Type;

const email = Schema.String.check(Schema.isMaxLength(320)).pipe(Schema.decodeTo(AuthSchema.Email));
const password = Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(4096)));
const secret = Schema.RedactedFromValue(Schema.String.check(Schema.isMaxLength(4096)));

export const PasswordFailure = Schema.Union([
  Password.PasswordRejected,
  Password.PasswordUnavailable,
  Password.PasswordActionRequired,
  Password.PasswordMethodUnsupported,
  Password.NewPasswordRejected,
  Password.PasswordCheckUnavailable,
]);

const mutationResult = Schema.Struct({
  invalidation: Sessions.SessionInvalidationWindow,
});

const RegisterInput = Schema.Struct({
  requestId: Password.PasswordCommandId,
  email,
  newPassword: password,
  registration: Registration,
});

export const AuthApi: AnyAuthContract = AuthContract.make("mattrax/auth", {
  basePath: "/api/v1",
  claims: AuthClaims,
  actions: (sessions) => ({
    signIn: AuthContract.passwordSignIn(sessions, { strategy: "password" }),

    register: AuthContract.action({
      payload: RegisterInput,
      success: Schema.TaggedStruct("RegistrationAccepted", {}),
      error: PasswordFailure,
      mode: "mutation",
      replay: "idempotent",
      strategy: "password",
    }),

    requestReset: AuthContract.action({
      payload: Schema.Struct({
        flowId: Sessions.AuthenticationFlowId,
        email,
        requestId: Proofs.ProofRequestId,
        locale: Schema.String,
      }),
      success: Proofs.ProofRequestReceipt,
      error: PasswordFailure,
      mode: "mutation",
      replay: "non-idempotent",
      strategy: "password",
    }),

    completeReset: AuthContract.action({
      payload: Schema.Struct({
        flowId: Sessions.AuthenticationFlowId,
        email,
        commandId: Password.PasswordCommandId,
        newPassword: password,
        reference: Proofs.ProofReference,
        secret,
      }),
      success: mutationResult,
      error: PasswordFailure,
      mode: "mutation",
      replay: "single-use",
      credentials: true,
      strategy: "password",
    }),

    changePassword: AuthContract.action({
      payload: Schema.Struct({
        commandId: Password.PasswordCommandId,
        currentPassword: Schema.optionalKey(password),
        newPassword: password,
      }),
      success: mutationResult,
      error: PasswordFailure,
      mode: "mutation",
      replay: "non-idempotent",
      credentials: true,
      strategy: "password",
    }),
  }),
});

/**
 * The auth definition used by server Layers. The reset URL is the only
 * origin-specific value; persistence only reads the strategy metadata from this
 * definition, so the placeholder origin is safe for schema generation.
 */
export const makeAppAuth = (origin: string): any =>
  Auth.make(AuthApi, {
    sessions: Sessions.stateful({
      maxAge: "30 days",
      idleTimeout: "30 days",
      renewAfter: "1 day",
    }),
    strategies: {
      password: Password.make({
        registration: Registration,
        reset: Password.resetLink({ url: `${origin}/reset-password` }),
      }),
    },
    defaultStrategy: "password",
  });

export const AuthDefinition = makeAppAuth("https://mattrax.invalid");
