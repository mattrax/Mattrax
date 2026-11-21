import type { Schema } from "effect";
import { Effect, Layer, Predicate } from "effect";
import { HttpRouter } from "effect/http";
import { AppleMdmService, appleMdmRoutes } from "@mattrax/dm-apple";
import type { AppleMdmTrustService } from "@mattrax/dm-apple";
import type { DdmDeclarationItems, DdmTokens } from "@mattrax/management-backend";
import {
  ManagementBackend,
  InternalServerError,
  ManagementManifest,
  ManagementNotSupported,
  ServerInitiatedUnenrollment,
  UnknownDevice,
  MdmOrigin,
} from "@mattrax/management-backend";
import type { AppleDeviceEvent, CheckinScope } from "@mattrax/management-backend";
import type { PlistValue } from "@mattrax/plist";
import { parsePlist, serializePlist } from "@mattrax/plist";

export type RecordedAppleEvent = {
  readonly scope: CheckinScope;
  readonly event: AppleDeviceEvent;
};

export type AppleHarnessState = {
  events: Array<RecordedAppleEvent>;
  checkinQueue: Array<ManagementManifest>;
  checkinError: "unenrolled" | "unknown" | "internal" | null;
  tokens: DdmTokens;
  items: DdmDeclarationItems;
  declarations: Map<string, Schema.JsonObject>;
  assets: Map<string, { content: Uint8Array; contentType: string }>;
  profile: { content: Uint8Array; contentType: string } | null;
  bootstrapToken: string | null;
  mdmOrigin: MdmOrigin;
};

export type AppleHarness = {
  readonly handler: (request: Request) => Promise<Response>;
  readonly state: AppleHarnessState;
  readonly service: AppleMdmService.Service;
  readonly config: {
    origin: string;
    authSecret: string;
    organizationId: string;
    organizationName: string;
    supportEmail: string;
  };
};

const origin = "https://mdm.example.test";

const authSecret = "compliance-profile-secret";

export const createAppleHarness = (
  options: {
    readonly trust?: AppleMdmTrustService;
    /** Simulate a backend that refuses to bind the user to the device. */
    readonly unmanagedUser?: boolean;
  } = {},
): AppleHarness => {
  const state: AppleHarnessState = {
    events: [],
    checkinQueue: [],
    checkinError: null,
    tokens: {
      activationsToken: "activation-token",
      configurationsToken: "configuration-token",
      assetsToken: "asset-token",
      managementToken: "management-token",
      declarationsToken: "declarations-token",
    },
    items: {
      activations: [{ identifier: "activation.one", serverToken: "a1" }],
      configurations: [{ identifier: "configuration.one", serverToken: "c1" }],
      assets: [{ identifier: "asset.one", serverToken: "s1" }],
      management: [{ identifier: "management.one", serverToken: "m1" }],
    },
    declarations: new Map<string, Schema.JsonObject>([
      [
        "configuration/configuration.one",
        {
          Type: "com.apple.configuration.management.test",
          Identifier: "configuration.one",
          ServerToken: "c1",
          Payload: { Enabled: true },
        },
      ],
      [
        "activation/activation.one",
        {
          Type: "com.apple.activation.simple",
          Identifier: "activation.one",
          ServerToken: "a1",
          Payload: {},
        },
      ],
      [
        "management/management.one",
        {
          Type: "com.apple.management.organization-info",
          Identifier: "management.one",
          ServerToken: "m1",
          Payload: { Name: "Example" },
        },
      ],
    ]),
    assets: new Map(),
    profile: null,
    bootstrapToken: "Ym9vdHN0cmFwLXRva2Vu",
    mdmOrigin: new MdmOrigin({ url: origin }),
  };

  const config = {
    origin,
    authSecret,
    organizationId: "tenant-compliance",
    organizationName: "Compliance Test",
    supportEmail: "support@example.test",
  };

  const backend = ManagementBackend.of({
    appleDeviceEvent: (scope, event) =>
      options.unmanagedUser && Predicate.isTagged(event, "UserAuthenticate")
        ? Effect.fail(new UnknownDevice())
        : Effect.sync(() => {
            state.events.push({ scope, event });
          }),
    getAppleBootstrapToken: () => Effect.succeed(state.bootstrapToken),
    appleReturnToServiceConfiguration: () => Effect.succeed({ enabled: false }),
    appleManagementCheckin: () => {
      if (state.checkinError === "unenrolled")
        return Effect.fail(new ServerInitiatedUnenrollment());

      if (state.checkinError === "unknown") return Effect.fail(new ManagementNotSupported());

      if (state.checkinError === "internal") return Effect.fail(new InternalServerError());

      const next = state.checkinQueue.shift();

      return Effect.succeed(next ?? ManagementManifest.members[0].make({}));
    },
    getAppleDeclarationTokens: () => Effect.succeed(state.tokens),
    getAppleDeclarationItems: () => Effect.succeed(state.items),
    getAppleDeclaration: (_scope, type, identifier) =>
      Effect.succeed(state.declarations.get(`${type}/${identifier}`) ?? null),
    getAppleAsset: (_certificate, identifier) =>
      Effect.succeed(state.assets.get(identifier) ?? null),
    getAppleProfile: (_policyId, _kind, _deviceId) => Effect.succeed(state.profile),
    windowsDiscovery: () => Effect.fail(new ManagementNotSupported()),
    getWindowsEnrollmentPolicy: () => Effect.fail(new ManagementNotSupported()),
    windowsEnroll: () => Effect.fail(new ManagementNotSupported()),
    windowsManagementCheckin: () => Effect.fail(new ManagementNotSupported()),
    windowsDeviceEvent: () => Effect.void,
  });

  const service = AppleMdmService.make({
    backend,
    config,
    topic: "com.apple.mgmt.External.compliance",
    trust: options.trust,
  });

  const layer = appleMdmRoutes.pipe(Layer.provideMerge(Layer.succeed(AppleMdmService, service)));
  const { handler } = HttpRouter.toWebHandler(layer, { disableLogger: true });

  return { handler, state, service, config };
};

export const serializeAppleBody = (body: PlistValue): Promise<string> =>
  Effect.runPromise(serializePlist(body));

export const parseAppleBody = (body: string): Promise<PlistValue> =>
  Effect.runPromise(parsePlist(body));

export const appleMdmRequest = async (
  body: PlistValue,
  options: { headers?: Record<string, string>; path?: string; method?: string } = {},
): Promise<Request> =>
  new Request(`${origin}${options.path ?? "/mdm/apple/mdm"}`, {
    method: options.method ?? "PUT",
    headers: {
      "content-type": "application/x-apple-aspen-mdm",
      ...options.headers,
    },
    body: await serializeAppleBody(body),
  });

export const applePlistResponse = async (response: Response): Promise<PlistValue> =>
  parseAppleBody(await response.text());

export const base64Utf8 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};
