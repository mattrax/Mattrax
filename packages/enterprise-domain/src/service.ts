import { Context } from "effect";
import type { Effect } from "effect";
import type { Schema } from "effect";
import type { StepUpAction } from "./stepUp.js";
import type { EnterpriseApplicationError } from "./Errors.js";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import type {
  ApplicationStorefrontRefreshResult,
  RefreshApplicationStorefrontsRequest,
} from "./Application.js";

/* oxlint-disable-next-line typescript/no-explicit-any -- The monolithic service
 * remains incremental migration debt. New vertical slices use typed services;
 * this index signature only keeps the legacy handler composition available. */
type Dynamic = any;

type HeadersRecord = Record<string, string | string[] | undefined>;

export type EnterpriseAuthUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image?: string | null;
  readonly authRevision: string;
  readonly defaultTenantId: string | null;
  readonly totpEnabled: boolean | null;
  readonly passkeyEnabled: boolean | null;
};

/** The session fields the backend consumes; all other auth data stays opaque. */
export type EnterpriseAuthSession = {
  readonly sessionId: string;
  readonly subjectId: string;
  readonly claims: {
    readonly name?: string | null;
    readonly email?: string | null;
    readonly emailVerified?: boolean | null;
  };
};

export type EnterpriseAuthApiToken = {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly scopes: Schema.Json;
  readonly tenantId: string | null;
};

export type EnterpriseAuthOAuthToken = {
  readonly accountId: string;
  readonly connectionId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly scopes: ReadonlyArray<string>;
};

export type EnterpriseAuthResolved = {
  readonly user: EnterpriseAuthUser;
  readonly session?: EnterpriseAuthSession;
  readonly apiToken?: EnterpriseAuthApiToken;
  readonly oauth?: EnterpriseAuthOAuthToken;
};

export type EnterpriseAuthFailure = Error | Schema.Json;

export type EnterpriseStepUpMethods = {
  readonly totp: boolean;
  readonly passkey: boolean;
};

type AuthJsonResult = Effect.Effect<Schema.Json, EnterpriseAuthFailure>;

/** Typed catalogue-storefront vertical, independent of the legacy RPC record. */
export class ApplicationStorefrontService extends Context.Service<
  ApplicationStorefrontService,
  {
    refresh(
      request: HttpServerRequest,
      tenantId: string,
      applicationId: string,
      payload: RefreshApplicationStorefrontsRequest,
    ): Effect.Effect<ApplicationStorefrontRefreshResult, EnterpriseApplicationError>;
  }
>()("@mattrax/enterprise-domain/ApplicationStorefrontService") {}

export class EnterpriseAuth extends Context.Service<
  EnterpriseAuth,
  {
    requireUser(
      requestLike: Request | { readonly headers: HeadersRecord },
    ): Effect.Effect<EnterpriseAuthResolved, EnterpriseAuthFailure>;
    /**
     * Resolve the caller and require a step-up grant for one action. Browser
     * sessions must present `x-mattrax-step-up`; bearer tokens are exempt
     * because they are already an explicitly issued, scoped credential.
     */
    requireStepUp(
      requestLike: Request | { readonly headers: HeadersRecord },
      action: StepUpAction,
    ): Effect.Effect<EnterpriseAuthResolved, EnterpriseAuthFailure>;
    stepUpMethods(
      requestLike: Request | { readonly headers: HeadersRecord },
    ): Effect.Effect<EnterpriseStepUpMethods, EnterpriseAuthFailure>;
    stepUpTotp(request: Request, payload: unknown): AuthJsonResult;
    beginStepUpPasskey(request: Request, payload: unknown): AuthJsonResult;
    completeStepUpPasskey(request: Request, payload: unknown): AuthJsonResult;
    listMcpConnections(request: Request): AuthJsonResult;
    revokeMcpConnection(request: Request, connectionId: string): AuthJsonResult;
    listApiTokens(request: Request): AuthJsonResult;
    createApiToken(request: Request, payload: unknown): AuthJsonResult;
    revokeApiToken(request: Request, tokenId: string): AuthJsonResult;
    requestEmailChange(request: Request, payload: unknown): AuthJsonResult;
    requestEmailVerification(request: Request): AuthJsonResult;
    verifyEmail(request: Request, payload: unknown): AuthJsonResult;
    verifyEmailChange(payload: unknown): AuthJsonResult;
    /** Cancel a pending address change from the old address's link. */
    cancelEmailChange(payload: unknown): AuthJsonResult;
  }
>()("@mattrax/enterprise-domain/EnterpriseAuth") {}

export class EnterpriseService extends Context.Service<
  EnterpriseService,
  Record<string, (...args: Array<Dynamic>) => Effect.Effect<Dynamic, Dynamic, Dynamic>>
>()("@mattrax/enterprise-domain/EnterpriseService") {}
