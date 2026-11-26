import type { Effect } from "effect";
import { Context, Layer } from "effect";
import {
  MtlsPushTransport,
  NoopPushTransport,
  NodePushTransport,
  RelayPushTransport,
} from "./transport.js";
import type {
  ApnsError,
  ApnsPushRequest,
  ApnsPushTransport,
  RelayPushTransportOptions,
} from "./transport.js";

export declare namespace ApnsService {
  export type Service = {
    /** Whether this deployment can deliver pushes. Devices still poll when false. */
    readonly available: boolean;
    readonly transport: string;
    readonly push: (request: ApnsPushRequest) => Effect.Effect<void, ApnsError>;
  };
}

export class ApnsService extends Context.Service<ApnsService, ApnsService.Service>()(
  "ApnsService",
) {}

export const makeApnsService = (transport: ApnsPushTransport): ApnsService.Service =>
  ApnsService.of({
    available: transport.available,
    transport: transport.name,
    push: transport.push,
  });

export const ApnsServiceLayer = (transport: ApnsPushTransport) =>
  Layer.succeed(ApnsService, makeApnsService(transport));

/**
 * Backwards-compatible constructor: a Node HTTP/2 transport preconfigured with
 * one certificate/key pair. Used by single-certificate whitelabel deployments.
 */
export const ApnsServiceLive = (certPem: string, keyPem: string) =>
  ApnsServiceLayer(NodePushTransport({ certPem, privateKeyPem: keyPem }));

/** Direct delivery for self-hosted deployments using the tenant certificate. */
export const ApnsServiceNode = ApnsServiceLayer(NodePushTransport());

/** Workers mTLS Fetcher binding for single-tenant whitelabel deployments. */
export const ApnsServiceMtls = (fetcher: { fetch: (request: Request) => Promise<Response> }) =>
  ApnsServiceLayer(MtlsPushTransport(fetcher));

/** Hosted multi-tenant Cloud delivery through an HMAC-signed relay. */
export const ApnsServiceRelay = (options: RelayPushTransportOptions) =>
  ApnsServiceLayer(RelayPushTransport(options));

/** Fallback when no push transport is configured. */
export const ApnsServiceNoop = (reason?: string) => ApnsServiceLayer(NoopPushTransport(reason));
