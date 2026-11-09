import type { AnyAuthContract } from "@yielded/auth/AuthContract";
import {
  Auth,
  AuthContract,
  Email,
  Operations,
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

export class SsoRejected extends Schema.TaggedError<SsoRejected>()("SsoRejected", {
  message: Schema.String,
}) {}

export const EmailCodeFailure = Schema.Union([
  Email.EmailRejected,
  Email.EmailUnavailable,
  Email.EmailActionRequired,
  Email.EmailMethodUnsupported,
]);

const EmailSignInBase = {
  flowId: Operations.RequestBindingFlowId,
  email,
  returnTarget: Schema.String.check(Schema.isMaxLength(2048)),
};

export const RequestEmailCodeInput = Schema.Struct({
  ...EmailSignInBase,
  requestId: Proofs.ProofRequestId,
  locale: Schema.String.check(Schema.isMaxLength(32)),
});

export const CompleteEmailCodeInput = Schema.Struct({
  ...EmailSignInBase,
  reference: Proofs.ProofReference,
  secret,
});

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

    beginEmailSignIn: AuthContract.action({
      payload: Schema.Struct({ flowId: Operations.RequestBindingFlowId }),
      success: Operations.RequestBindingPublic,
      error: EmailCodeFailure,
      mode: "mutation",
      credentials: true,
      replay: "non-idempotent",
      method: "beginSignIn",
      strategy: "email",
    }),

    requestEmailCode: AuthContract.action({
      payload: RequestEmailCodeInput,
      success: Proofs.ProofRequestReceipt,
      error: EmailCodeFailure,
      mode: "mutation",
      replay: "non-idempotent",
      method: "signIn",
      strategy: "email",
      requestFields: { requestBinding: "request-binding" },
    }),

    completeEmailCode: AuthContract.action({
      payload: CompleteEmailCodeInput,
      success: Schema.Struct({
        completion: sessions.CompletionResult,
        returnTarget: Email.SafeReturnTarget,
      }),
      error: EmailCodeFailure,
      mode: "mutation",
      credentials: true,
      replay: "single-use",
      method: "completeSignIn",
      strategy: "email",
      requestFields: { requestBinding: "request-binding" },
      subject: {
        fromSuccess: (value) =>
          value.completion._tag === "Authenticated"
            ? value.completion.session.subjectId
            : undefined,
        sessionFromSuccess: (value) =>
          value.completion._tag === "Authenticated" ? value.completion.session : undefined,
      },
    }),

    ssoSignIn: AuthContract.action({
      payload: Schema.Struct({ token: Schema.String }),
      success: sessions.CompletionResult,
      error: SsoRejected,
      mode: "mutation",
      credentials: true,
      replay: "single-use",
      method: "signIn",
      strategy: "sso",
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
 * The auth definition used by server Layers. `resetUrl` is the HTTPS landing
 * page for password-reset links; it defaults to the canonical origin. Keeping
 * it separate lets local HTTP development run with the production reset URL
 * (the proof library refuses non-HTTPS landing pages).
 */
export const makeAppAuth = (
  origin: string,
  resetUrl?: string,
  extraStrategies: Record<string, any> = {},
): any =>
  Auth.make(AuthApi, {
    sessions: Sessions.stateful({
      maxAge: "30 days",
      idleTimeout: "30 days",
      renewAfter: "1 day",
    }),
    strategies: {
      password: Password.make({
        registration: Registration,
        reset: Password.resetLink({ url: resetUrl ?? `${origin}/reset-password` }),
      }),
      email: Email.makeCode({ digits: 6 }),
      ...extraStrategies,
    },
    defaultStrategy: "password",
  });

export const AuthDefinition = makeAppAuth("https://mattrax.invalid");
