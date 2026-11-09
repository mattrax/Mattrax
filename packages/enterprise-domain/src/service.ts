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
    readonly verifyEmail: (payload: Dynamic) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
    readonly verifyEmailChange: (payload: Dynamic) => Effect.Effect<Dynamic, Dynamic, Dynamic>;
  }
>()("@mattrax/enterprise-domain/EnterpriseAuth") {}

export class EnterpriseService extends Context.Service<
  EnterpriseService,
  Record<string, (...args: Array<Dynamic>) => Effect.Effect<Dynamic, Dynamic, Dynamic>>
>()("@mattrax/enterprise-domain/EnterpriseService") {}
