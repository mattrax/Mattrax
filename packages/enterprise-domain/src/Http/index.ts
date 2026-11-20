import { Effect } from "effect";
import { HttpApi } from "effect/http-api";
import { HttpApiClient } from "effect/http-api";
import type { HttpClient } from "effect/http";

import { enterpriseAccountApi } from "./AccountApi.js";
import { enterpriseAdminApi } from "./AdminApi.js";
import { enterpriseAdeApi } from "./AdeApi.js";
import { enterpriseAttributeApi } from "./AttributeApi.js";
import { enterpriseApi } from "./EnterpriseApi.js";
import { enterpriseDashboardApi } from "./DashboardApi.js";
import { enterpriseGroupApi } from "./GroupApi.js";
import { enterpriseIdentityApi } from "./IdentityApi.js";
import { enterpriseUserApi } from "./UserApi.js";
import { enterpriseSoftwareUpdateApi } from "./SoftwareUpdateApi.js";
import { enterpriseListApi } from "./ListApi.js";
import { enterpriseWindowsApi } from "./WindowsApi.js";

export * from "./AccountApi.js";

export * from "./AdminApi.js";

export * from "./AdeApi.js";

export * from "./AttributeApi.js";

export * from "./EnterpriseApi.js";

export * from "./DashboardApi.js";

export * from "./GroupApi.js";

export * from "./IdentityApi.js";

export * from "./UserApi.js";

export * from "./SoftwareUpdateApi.js";

export * from "./ListApi.js";

export * from "./WindowsApi.js";

export * from "./Params.js";

export * from "./ScriptApi.js";

export * from "./MigrationApi.js";

export const enterpriseHttpApi: HttpApi.HttpApi<
  "MattraxEnterprise",
  | typeof enterpriseAccountApi
  | typeof enterpriseAdminApi
  | typeof enterpriseApi
  | typeof enterpriseGroupApi
  | typeof enterpriseAdeApi
  | typeof enterpriseAttributeApi
  | typeof enterpriseDashboardApi
  | typeof enterpriseIdentityApi
  | typeof enterpriseUserApi
  | typeof enterpriseSoftwareUpdateApi
  | typeof enterpriseListApi
  | typeof enterpriseWindowsApi
> = HttpApi.make("MattraxEnterprise")
  .add(enterpriseAccountApi)
  .add(enterpriseAdminApi)
  .add(enterpriseApi)
  .add(enterpriseGroupApi)
  .add(enterpriseAdeApi)
  .add(enterpriseAttributeApi)
  .add(enterpriseDashboardApi)
  .add(enterpriseIdentityApi)
  .add(enterpriseUserApi)
  .add(enterpriseSoftwareUpdateApi)
  .add(enterpriseListApi)
  .add(enterpriseWindowsApi);

/** The flattened client groups the dashboard can call. */
export type EnterpriseClient = HttpApiClient.Client<typeof enterpriseAccountApi> &
  HttpApiClient.Client<typeof enterpriseAdminApi> &
  HttpApiClient.Client<typeof enterpriseApi> &
  HttpApiClient.Client<typeof enterpriseGroupApi> &
  HttpApiClient.Client<typeof enterpriseAdeApi> &
  HttpApiClient.Client<typeof enterpriseAttributeApi> &
  HttpApiClient.Client<typeof enterpriseDashboardApi> &
  HttpApiClient.Client<typeof enterpriseIdentityApi> &
  HttpApiClient.Client<typeof enterpriseUserApi> &
  HttpApiClient.Client<typeof enterpriseSoftwareUpdateApi> &
  HttpApiClient.Client<typeof enterpriseListApi> &
  HttpApiClient.Client<typeof enterpriseWindowsApi>;

export type EnterpriseClientOptions = NonNullable<Parameters<typeof HttpApiClient.make>[1]>;

/**
 * Build the browser-safe enterprise client. Declared here so the composed API
 * type never has to be serialised into a `.d.ts`.
 */
export const makeEnterpriseClient = (
  options?: EnterpriseClientOptions,
): Effect.Effect<EnterpriseClient, never, HttpClient.HttpClient> =>
  // SAFETY: `HttpApiClient.make` builds exactly the groups composed above; the
  // assertion names that intersection and removes the generated union.
  HttpApiClient.make(enterpriseHttpApi, options) as Effect.Effect<
    EnterpriseClient,
    never,
    HttpClient.HttpClient
  >;
