import {
  KdfAdmission,
  PasswordHashing,
  defaultScryptPasswordHashingConfig,
} from "@yielded/auth/Password";
import * as PasswordScrypt from "@yielded/auth/PasswordScrypt";
import * as WebCrypto from "@yielded/auth/WebCrypto";
import { Layer } from "effect";
import * as Kdf from "effect/crypto/Kdf";
import type { AuthLiveOptions } from "@mattrax/enterprise-backend";

/**
 * Crypto and password services for the Node entry point.
 *
 * The Cloudflare entry uses the Workers layer, whose Argon2id comes from a WASM
 * module. Node uses its own scrypt implementation through `PasswordScrypt`, so
 * no WASM import is needed. Scrypt is the portable default; this deployment has
 * no password sign-in, but passkey/session machinery still needs the service.
 */
const platform = Layer.mergeAll(
  WebCrypto.layer,
  Kdf.layerWebCrypto,
  PasswordScrypt.layer,
  KdfAdmission.layer(),
);

export const nodeCryptoLayer: AuthLiveOptions["cryptoLayer"] = PasswordHashing.layer(
  defaultScryptPasswordHashingConfig,
).pipe(Layer.provideMerge(platform));
