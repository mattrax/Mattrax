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
  /** Verified client certificate DER as standard base64. */
  readonly identityCertificateDerBase64?: string;
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
  readonly fault: (message: string, relatesTo?: string) => Effect.Effect<string, WindowsMdmError>;
}

export class WindowsMdmService extends Context.Service<
  WindowsMdmService,
  WindowsMdmServiceContract
>()("WindowsMdmService") {}

export declare namespace WindowsMdmService {
  export type Service = WindowsMdmServiceContract;
}

/** Share one in-flight dynamic import, but allow a later request to retry it. */
export const retryingLazyImport = <A>(importModule: () => Promise<A>) => {
  let implementation: Promise<A> | undefined;

  return (): Promise<A> => {
    if (implementation) return implementation;

    const pending: Promise<A> = importModule().catch((error: unknown) => {
      if (implementation === pending) implementation = undefined;

      throw error;
    });

    implementation = pending;

    return pending;
  };
};

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

      // Several calls share one import, but a rejected chunk load is evicted so
      // a transient deployment/cache failure does not poison the whole isolate.
      const load = retryingLazyImport(() =>
        import("./service-impl.js").then((module) => module.makeWindowsMdmService(backend, config)),
      );

      // A rejected chunk load is a typed error, so the routes answer with a
      // SOAP fault instead of a defect.
      const delegate = <E>(run: (service: WindowsMdmServiceContract) => Effect.Effect<string, E>) =>
        Effect.flatMap(
          Effect.tryPromise({
            try: () => load(),
            catch: (cause) =>
              new WindowsMdmError({
                message:
                  "The Windows MDM protocol handler could not be loaded. Retry the request; if it persists, contact support.",
                cause,
                code: "implementation_unavailable",
              }),
          }),
          run,
        );

      return WindowsMdmService.of({
        mdmOrigin,
        discovery: (xml, context) => delegate((service) => service.discovery(xml, context)),
        policy: (xml, context) => delegate((service) => service.policy(xml, context)),
        enroll: (xml, context) => delegate((service) => service.enroll(xml, context)),
        management: (xml, context) => delegate((service) => service.management(xml, context)),
        // Fault encoding is best effort: when the implementation itself is
        // unavailable, return an empty body and let the route's minimal fixed
        // envelope stand in for it.
        fault: (message, relatesTo) =>
          delegate((service) => service.fault(message, relatesTo)).pipe(
            Effect.catch(() => Effect.succeed("")),
          ),
      });
    }),
  );
