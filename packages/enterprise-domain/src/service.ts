import { Context, type Effect } from "effect";

type Dynamic = any;
type HeadersRecord = Record<string, string | string[] | undefined>;

export type EnterpriseAuthUser = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image?: string | null;
};

export type EnterpriseAuthResolved = {
  readonly user: EnterpriseAuthUser;
  readonly session?: Dynamic;
  readonly apiToken?: Dynamic;
};

export class EnterpriseAuth extends Context.Service<
  EnterpriseAuth,
  {
    readonly requireUser: (
      requestLike: Request | { readonly headers: HeadersRecord },
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    /**
     * Resolve the caller and require a step-up grant for one action. Browser
     * sessions must present `x-mattrax-step-up`; bearer tokens are exempt
     * because they are already an explicitly issued, scoped credential.
     */
    readonly requireStepUp: (
      requestLike: Request | { readonly headers: HeadersRecord },
      action: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly stepUpMethods: (
      requestLike: Request | { readonly headers: HeadersRecord },
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly stepUpPassword: (
      request: Request,
      payload: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly stepUpTotp: (
      request: Request,
      payload: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly beginStepUpPasskey: (
      request: Request,
      payload: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly completeStepUpPasskey: (
      request: Request,
      payload: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly listMcpConnections: (request: Request) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly revokeMcpConnection: (
      request: Request,
      connectionId: string,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly listApiTokens: (request: Request) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly createApiToken: (
      request: Request,
      payload: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly revokeApiToken: (
      request: Request,
      tokenId: string,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly requestEmailChange: (
      request: Request,
      payload: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly requestEmailVerification: (
      request: Request,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly verifyEmail: (
      request: Request,
      payload: Dynamic,
    ) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly verifyEmailChange: (payload: Dynamic) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
  }
>()("@mattrax/enterprise-domain/EnterpriseAuth") {}

export class EnterpriseService extends Context.Service<
  EnterpriseService,
  Record<string, (...args: Array<Dynamic>) => Effect.Effect<Dynamic, Dynamic, Dynamic>>
>()("@mattrax/enterprise-domain/EnterpriseService") {}
