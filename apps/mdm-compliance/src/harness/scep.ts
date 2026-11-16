import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import {
  ScepRepository,
  ScepService,
  scepRoutes,
  type ScepAuthentication,
  type ScepIssuedCertificate,
  type ScepPkcsReq,
} from "@mattrax/scep";
import { ScepError } from "@mattrax/scep";
import { createCaFixture, type ScepCaFixture } from "../fixtures/pki.ts";

let sharedCa: Promise<ScepCaFixture> | undefined;

export const sharedScepCa = (): Promise<ScepCaFixture> => {
  sharedCa ??= createCaFixture();

  return sharedCa;
};

export type ScepHarnessState = {
  readonly ca: ScepCaFixture;
  authenticate: (request: ScepPkcsReq) => Effect.Effect<ScepAuthentication | void, ScepError>;
  issued: Map<string, ScepIssuedCertificate>;
  recorded: ScepIssuedCertificate[];
  saveCount: number;
  getCaFailure: ScepError | null;
};

export type ScepHarness = {
  readonly handler: (request: Request) => Promise<Response>;
  readonly state: ScepHarnessState;
};

export const createScepHarness = async (
  options: {
    readonly authenticate?: ScepHarnessState["authenticate"];
    readonly issued?: Iterable<ScepIssuedCertificate>;
  } = {},
): Promise<ScepHarness> => {
  const ca = await sharedScepCa();

  const state: ScepHarnessState = {
    ca,
    authenticate:
      options.authenticate ??
      (() => Effect.succeed({ organizationalUnit: "tenant-authenticated" })),
    issued: new Map((options.issued ? [...options.issued] : []).map((item) => [item.serial, item])),
    recorded: [],
    saveCount: 0,
    getCaFailure: null,
  };

  const repository = Layer.succeed(
    ScepRepository,
    ScepRepository.of({
      getCa: () =>
        state.getCaFailure
          ? Effect.fail(state.getCaFailure)
          : Effect.succeed({ certPem: ca.certPem, privateKeyJwk: ca.privateKeyJwk }),
      saveCa: (_scope, candidate) =>
        Effect.sync(() => {
          state.saveCount++;

          return candidate;
        }),
      replaceCa: (_scope, candidate) => Effect.succeed(candidate),
      rotateCa: (_scope, candidate) => Effect.succeed(candidate),
      trustedCaCertificates: () => Effect.succeed([ca.certPem]),
      listRetiredCa: () => Effect.succeed([]),
      authenticatePkcsReq: (_scope, request) => state.authenticate(request),
      recordIssuedCertificate: (certificate) =>
        Effect.sync(() => {
          state.recorded.push(certificate);
          state.issued.set(certificate.serial, certificate);
        }),
      findIssuedCertificate: (_scope, serial) => Effect.succeed(state.issued.get(serial) ?? null),
    }),
  );

  const serviceLayer = ScepService.pipe(Layer.provideMerge(repository));
  const appLayer = scepRoutes.pipe(Layer.provideMerge(serviceLayer));
  const { handler } = HttpRouter.toWebHandler(appLayer, { disableLogger: true });

  return { handler, state };
};

export const scepGet = (operation: string): Request =>
  new Request(
    `https://mdm.example.test/mdm/apple/scep/tenant-authenticated?operation=${encodeURIComponent(operation)}`,
  );

export const scepPost = (body: ArrayBuffer | Uint8Array): Request =>
  new Request(
    "https://mdm.example.test/mdm/apple/scep/tenant-authenticated?operation=PKIOperation",
    {
      method: "POST",
      headers: { "content-type": "application/x-pki-message" },
      body: body instanceof Uint8Array ? Uint8Array.from(body).buffer : body,
    },
  );
