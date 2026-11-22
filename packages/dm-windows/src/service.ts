import { Context, Data, Effect, Layer } from "effect";
import type { WindowsFailurePhase } from "@mattrax/management-backend";
import { ManagementBackend, MdmOrigin } from "@mattrax/management-backend";

export class WindowsMdmError extends Data.TaggedError("WindowsMdmError")<{
  message: string;
  cause?: unknown;
  /** Where the fault happened, when it is more specific than the endpoint. */
  phase?: WindowsFailurePhase;
  /** Stable code for the recorded failure history. */
  code?: string;
  /** The backend wrote this failure to its durable history. */
  recorded?: boolean;
}> {}

/**
 * Request-scoped context the HTTP layer forwards from URL/headers. The tenant
 * token travels in `?tenant=` and identifies which organization the enrollment
 * link belongs to; the identity fields come from the verified mTLS handshake.
 */
export type WindowsMdmRequestContext = {
  readonly tenantToken?: string;
  readonly identityCertificate?: string;
  readonly identityCertificateSerial?: string;
  /** Verified client address, set by the deployment boundary for the audit log. */
  readonly clientIp?: string;
  /** Bounded request `User-Agent`; audit only. */
  readonly userAgent?: string;
};

export interface WindowsMdmServiceContract {
  readonly mdmOrigin: MdmOrigin;
  readonly discovery: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly policy: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly enroll: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly management: (
    xml: string,
    context?: WindowsMdmRequestContext,
  ) => Effect.Effect<string, WindowsMdmError>;
  readonly fault: (message: string, relatesTo?: string) => Effect.Effect<string, never>;
}

export class WindowsMdmService extends Context.Service<
  WindowsMdmService,
  WindowsMdmServiceContract
>()("WindowsMdmService") {}

export declare namespace WindowsMdmService {
  export type Service = WindowsMdmServiceContract;
}

/**
 * Windows MDM protocol service.
 *
 * The protocol implementation (SOAP envelopes, SyncML, WSTEP) is imported on
 * the first Windows request rather than at module evaluation: a deployment
 * whose fleet is Apple-only or whose traffic is the browser API never pays for
 * it. Each method delegates to a single lazily-built implementation per layer.
 */
export const WindowsMdmServiceLive = (config: { origin: string; providerId?: string }) =>
  Layer.effect(
    WindowsMdmService,
    Effect.gen(function* () {
      const backend = yield* ManagementBackend;
      const mdmOrigin = new MdmOrigin({ url: config.origin });

      // `??=` caches the import for this layer, so several calls in one request
      // share one implementation and the module is evaluated once per isolate.
      let implementation: Promise<WindowsMdmServiceContract> | undefined;

      const load = (): Promise<WindowsMdmServiceContract> =>
        (implementation ??= import("./service-impl.js").then((module) =>
          module.makeWindowsMdmService(backend, config),
        ));

      const delegate = <E>(run: (service: WindowsMdmServiceContract) => Effect.Effect<string, E>) =>
        Effect.flatMap(Effect.promise(load), run);

      return WindowsMdmService.of({
        mdmOrigin,
        discovery: (xml, context) => delegate((service) => service.discovery(xml, context)),
        policy: (xml, context) => delegate((service) => service.policy(xml, context)),
        enroll: (xml, context) => delegate((service) => service.enroll(xml, context)),
        management: (xml, context) => delegate((service) => service.management(xml, context)),
        fault: (message, relatesTo) => delegate((service) => service.fault(message, relatesTo)),
      });
    }),
  );
