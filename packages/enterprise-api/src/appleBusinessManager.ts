import { Effect } from "effect";
// The error types live in their own module so this boundary can report an
// unavailable client without statically importing the clients themselves.
import { AppleBusinessManagerError, VppError } from "@mattrax/apple-business-manager/errors";
import type * as AppleBusinessManager from "@mattrax/apple-business-manager";

/**
 * Apple Business Manager and the volume-purchase client.
 *
 * Both are deployment administration paths, not part of a normal request, so the
 * module is imported on first use instead of at module evaluation. The wrappers
 * below keep the call sites identical to a static import, and an unavailable
 * chunk is reported through the same typed error the client itself uses, so
 * existing `Effect.catch`/`mapError` paths keep handling it (a rejected
 * `import()` must not become a defect).
 */

/** The Apple Business Manager module, as loaded by {@link makeAppleBusinessManagerAccess}. */
export type AppleBusinessManagerModule = typeof AppleBusinessManager;

/** Loads the client module. Injectable so tests can reject the chunk. */
export type AppleBusinessManagerLoader = () => Promise<AppleBusinessManagerModule>;

/** One-line, secret-free description of a boundary failure cause. */
const describeFailure = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

const moduleUnavailable = (cause: unknown) =>
  new AppleBusinessManagerError({
    kind: "upstream",
    message: `The Apple Business Manager client could not be loaded: ${describeFailure(cause)}`,
    cause,
  });

const vppModuleUnavailable = (cause: unknown) =>
  new VppError({
    kind: "upstream",
    message: `The Apple Apps and Books client could not be loaded: ${describeFailure(cause)}`,
    cause,
  });

/**
 * Lazy access to the client. Every helper keeps the client function's own
 * signature; the only addition is the unavailable chunk, reported as an
 * `upstream` failure of the relevant client.
 */
export type AppleBusinessManagerAccess = Pick<
  AppleBusinessManagerModule,
  | "loadAppleBusinessManager"
  | "appleBusinessManagerInfo"
  | "saveAppleBusinessManagerToken"
  | "clearAppleBusinessManagerToken"
  | "syncAppleBusinessManagerDevices"
  | "assignAppleBusinessManagerDevice"
  | "createAdeProfileToken"
  | "readAdeProfileToken"
  | "openAbmCredential"
  | "vppInfo"
  | "saveVppToken"
  | "clearVppToken"
  | "syncVppAssets"
  | "findVppAsset"
  | "findVppAssetByStoreId"
  | "assignVppLicence"
  | "releaseVppLicence"
> & {
  /** Run against the Apple Business Manager client after loading it. */
  readonly withAppleBusinessManager: <A, E>(
    run: (module: AppleBusinessManagerModule) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | AppleBusinessManagerError>;
  /** Run against the Apps and Books client after loading it. */
  readonly withVpp: <A, E>(
    run: (module: AppleBusinessManagerModule) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | VppError>;
};

/**
 * Build the lazy accessors. The loader defaults to a dynamic import; tests pass
 * one that rejects to exercise the unavailable path.
 */
export const makeAppleBusinessManagerAccess = (
  load: AppleBusinessManagerLoader = () => import("@mattrax/apple-business-manager"),
): AppleBusinessManagerAccess => {
  const withAppleBusinessManager: AppleBusinessManagerAccess["withAppleBusinessManager"] = (run) =>
    Effect.flatMap(Effect.tryPromise({ try: () => load(), catch: moduleUnavailable }), run);

  const withVpp: AppleBusinessManagerAccess["withVpp"] = (run) =>
    Effect.flatMap(Effect.tryPromise({ try: () => load(), catch: vppModuleUnavailable }), run);

  return {
    withAppleBusinessManager,
    withVpp,
    loadAppleBusinessManager: (...args) =>
      withAppleBusinessManager((module) => module.loadAppleBusinessManager(...args)),
    appleBusinessManagerInfo: (...args) =>
      withAppleBusinessManager((module) => module.appleBusinessManagerInfo(...args)),
    saveAppleBusinessManagerToken: (...args) =>
      withAppleBusinessManager((module) => module.saveAppleBusinessManagerToken(...args)),
    clearAppleBusinessManagerToken: (...args) =>
      withAppleBusinessManager((module) => module.clearAppleBusinessManagerToken(...args)),
    syncAppleBusinessManagerDevices: (...args) =>
      withAppleBusinessManager((module) => module.syncAppleBusinessManagerDevices(...args)),
    assignAppleBusinessManagerDevice: (...args) =>
      withAppleBusinessManager((module) => module.assignAppleBusinessManagerDevice(...args)),
    createAdeProfileToken: (...args) =>
      withAppleBusinessManager((module) => module.createAdeProfileToken(...args)),
    readAdeProfileToken: (...args) =>
      withAppleBusinessManager((module) => module.readAdeProfileToken(...args)),
    // Async in the client. A rejected chunk rejects this promise, which the
    // caller's `Effect.tryPromise` already turns into its typed error.
    openAbmCredential: async (...args) => (await load()).openAbmCredential(...args),
    vppInfo: (...args) => withVpp((module) => module.vppInfo(...args)),
    saveVppToken: (...args) => withVpp((module) => module.saveVppToken(...args)),
    clearVppToken: (...args) => withVpp((module) => module.clearVppToken(...args)),
    syncVppAssets: (...args) => withVpp((module) => module.syncVppAssets(...args)),
    findVppAsset: (...args) => withVpp((module) => module.findVppAsset(...args)),
    findVppAssetByStoreId: (...args) => withVpp((module) => module.findVppAssetByStoreId(...args)),
    assignVppLicence: (...args) => withVpp((module) => module.assignVppLicence(...args)),
    releaseVppLicence: (...args) => withVpp((module) => module.releaseVppLicence(...args)),
  };
};

/** The accessors used by the API handlers. */
export const appleBusinessManager = makeAppleBusinessManagerAccess();
