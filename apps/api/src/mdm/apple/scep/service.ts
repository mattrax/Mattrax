import { Context, Effect, Layer } from "effect";
import { ScepError } from "../schema";
import { ScepRepository } from "./repository";
import {
  generateCaKeyPair,
  exportPrivateKeyJwk,
  importPrivateKeyJwk,
  exportPublicKeySpki,
  signData,
  pemEncode,
  pemDecode,
} from "./crypto";
import {
  buildTBSCertificate,
  buildCertificate,
  buildPkcs7Degenerate,
  parsePkcs7Content,
  parseCsr,
} from "./pkcs7";

const SCEP_CAPS = "SHA-256\nSHA-1\nAES\nDES3\nPOSTPKIOperation";

export class ScepService extends Context.Service<
  ScepService,
  {
    readonly getCaCaps: () => Effect.Effect<string, ScepError>;
    readonly getCaCert: () => Effect.Effect<ArrayBuffer, ScepError>;
    readonly pkiOperation: (message: ArrayBuffer) => Effect.Effect<ArrayBuffer, ScepError>;
  }
>()("ScepService") {}

export const ScepServiceLive = Layer.effect(
  ScepService,
  Effect.gen(function* () {
    const repo = yield* ScepRepository;

    const ensureCa = Effect.gen(function* () {
      const existing = yield* repo.getCa();
      if (existing) {
        const privateKey = yield* importPrivateKeyJwk(existing.privateKeyJwk);
        const certDer = pemDecode("CERTIFICATE", existing.certPem);
        return { privateKey, certDer: new Uint8Array(certDer), certPem: existing.certPem };
      }

      const keyPair = yield* generateCaKeyPair();
      const jwk = yield* exportPrivateKeyJwk(keyPair.privateKey);
      const spki = yield* exportPublicKeySpki(keyPair.publicKey);

      const notBefore = new Date();
      const notAfter = new Date(notBefore.getTime() + 10 * 365 * 24 * 60 * 60 * 1000);
      const tbs = buildTBSCertificate(
        1,
        "Mattrax SCEP CA",
        { notBefore, notAfter },
        "Mattrax SCEP CA",
        spki as ArrayBuffer,
        true,
      );
      const tbsBytes = tbs.buffer.slice(tbs.byteOffset, tbs.byteOffset + tbs.byteLength) as ArrayBuffer;
      const sig = yield* signData(keyPair.privateKey, tbsBytes);
      const certDer = buildCertificate(tbs, sig as ArrayBuffer);
      const certPem = pemEncode("CERTIFICATE", certDer.buffer as ArrayBuffer);

      yield* repo.saveCa(certPem, jwk);
      return { privateKey: keyPair.privateKey, certDer: new Uint8Array(certDer), certPem };
    });

    const getCaCaps = (): Effect.Effect<string, ScepError> => Effect.succeed(SCEP_CAPS);

    const getCaCert = (): Effect.Effect<ArrayBuffer, ScepError> =>
      Effect.gen(function* () {
        const ca = yield* ensureCa;
        const pkcs7 = buildPkcs7Degenerate(ca.certDer);
        return pkcs7.buffer.slice(pkcs7.byteOffset, pkcs7.byteOffset + pkcs7.byteLength) as ArrayBuffer;
      });

    const pkiOperation = (message: ArrayBuffer): Effect.Effect<ArrayBuffer, ScepError> =>
      Effect.gen(function* () {
        const ca = yield* ensureCa;
        const pkcs7Data = new Uint8Array(message);

        const innerContent = yield* parsePkcs7Content(pkcs7Data);
        const csrInfo = yield* parseCsr(innerContent);

        const notBefore = new Date();
        const notAfter = new Date(notBefore.getTime() + 365 * 24 * 60 * 60 * 1000);
        const serial = Math.floor(Math.random() * 0x7fffffff);

        const tbs = buildTBSCertificate(
          serial,
          "Mattrax SCEP CA",
          { notBefore, notAfter },
          csrInfo.subject,
          csrInfo.spki as ArrayBuffer,
          false,
        );
        const tbsBytes = tbs.buffer.slice(tbs.byteOffset, tbs.byteOffset + tbs.byteLength) as ArrayBuffer;
        const sig = yield* signData(ca.privateKey, tbsBytes);
        const certDer = buildCertificate(tbs, sig as ArrayBuffer);

        const pkcs7Response = buildPkcs7Degenerate(new Uint8Array(certDer));
        return pkcs7Response.buffer.slice(pkcs7Response.byteOffset, pkcs7Response.byteOffset + pkcs7Response.byteLength) as ArrayBuffer;
      });

    return ScepService.of({
      getCaCaps,
      getCaCert,
      pkiOperation,
    });
  }),
);
