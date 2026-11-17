import { createSignal } from "solid-js";
import {
  DEPLOYMENT_HEADER,
  DEPLOYMENT_META_NAME,
  deploymentIdFromResponse,
} from "./deployment-meta";

/**
 * Skew protection for a tab that outlives the deployment it was served from.
 *
 * Two failures matter:
 *
 * - a hashed chunk from the previous build no longer exists, so a dynamic
 *   import rejects. Reloading once is enough; the fresh HTML points at chunks
 *   that do exist. A cooldown stops a genuinely broken bundle from looping.
 * - the deployment changed while the tab stayed open. A non-blocking notice
 *   asks the user to reload when convenient instead of interrupting them.
 *
 * The pure decisions live here so they can be unit-tested in Node; the browser
 * wiring at the bottom only runs after hydration (and is skipped on the server).
 */

const CHUNK_RELOAD_KEY = "mattrax:skew:chunk-reload";

const ANNOUNCED_DEPLOYMENT_KEY = "mattrax:skew:announced";

/**
 * A query marker that survives the reload itself.
 *
 * `sessionStorage` is the normal guard, but browser policy can make it throw on
 * every access. The marker is written into the URL before reloading and read
 * once on the next boot, so even without storage a broken bundle gets exactly
 * one automatic reload rather than an infinite loop.
 */
export const CHUNK_RELOAD_PARAM = "__chunk_reload";

export const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

const DEPLOYMENT_POLL_INTERVAL_MS = 5 * 60_000;

const DEPLOYMENT_CHECK_THROTTLE_MS = 15_000;

/** Messages browsers and Vite use when a lazily loaded module cannot be fetched. */
const CHUNK_ERROR_FRAGMENTS = [
  "chunkloaderror",
  "loading chunk",
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "failed to load module script",
  "unable to preload css",
] as const;

/** The minimal storage surface used here; `Storage` and test doubles both fit. */
export interface DeploymentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const storageValue = (storage: DeploymentStorage | undefined, key: string): string | undefined => {
  try {
    return storage?.getItem(key) ?? undefined;
  } catch {
    // Storage can be disabled by browser policy; the caller still gets a
    // one-shot decision from its in-memory fallback.
    return undefined;
  }
};

const writeStorage = (storage: DeploymentStorage | undefined, key: string, value: string): void => {
  try {
    storage?.setItem(key, value);
  } catch {
    // The notice still appears; it just cannot be deduplicated across reloads.
  }
};

/** True when an error message describes a failed lazy import or chunk load. */
export function isChunkLoadFailure(message: string): boolean {
  const normalised = message.toLowerCase();

  return CHUNK_ERROR_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

/** True when a URL is a build asset served from this origin. */
export function isChunkAssetUrl(candidate: string, origin: string): boolean {
  try {
    const url = new URL(candidate, origin);

    return url.origin === origin && url.pathname.startsWith("/assets/");
  } catch {
    return false;
  }
}

const MESSAGE_ASSET_URL = /(?:https?:\/\/[^\s"'<>]+|\/assets\/[^\s"'<>]+)/i;

/**
 * Extract the error message from Vite's `vite:preloadError` event.
 *
 * Vite 8 dispatches a plain `Event` and assigns `payload` onto it; it is not a
 * `CustomEvent` and the DOM typings do not know about the field. CustomEvent
 * detail is also accepted for forward/backward compatibility.
 */
export function preloadFailureMessage(event: Event): string | undefined {
  // SAFETY: Vite defines `payload` on the Event it dispatches at runtime; the
  // DOM Event declaration has no field for it.
  const payload = (event as Event & { readonly payload?: unknown }).payload;
  const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
  const reason = payload ?? detail;

  return reason instanceof Error ? reason.message : undefined;
}

/**
 * Extract the failing module URL from a browser error message, but only when
 * it is one of this deployment's assets.
 *
 * Messages differ by browser and some (notably Safari) omit the URL entirely.
 * Without a same-origin `/assets/` URL the failure is not provably a stale
 * chunk, so detection fails closed instead of reloading for a third-party
 * module outage.
 */
export function chunkFailureAssetUrl(message: string, origin: string): string | undefined {
  if (!isChunkLoadFailure(message)) return undefined;

  const match = MESSAGE_ASSET_URL.exec(message);

  if (!match?.[0]) return undefined;

  const candidate = match[0].replace(/[.,;:]+$/, "");

  return isChunkAssetUrl(candidate, origin) ? candidate : undefined;
}

/**
 * Remove the one-shot reload marker from a URL without touching other query
 * parameters. `attempted` tells the installer that the current document was
 * already produced by an automatic reload.
 */
export function stripChunkReloadMarker(href: string) {
  const url = new URL(href);
  const attempted = url.searchParams.has(CHUNK_RELOAD_PARAM);

  if (attempted) url.searchParams.delete(CHUNK_RELOAD_PARAM);

  return { attempted, url: url.href };
}

/**
 * The URL to reload to, or `undefined` when this document must not reload
 * again. The marker is checked in the URL as well as in the caller's state so a
 * reload that happened before this module initialised is still respected.
 */
export function chunkReloadTarget(input: {
  readonly href: string;
  readonly storage: DeploymentStorage | undefined;
  readonly now: number;
  readonly alreadyAttempted?: boolean;
  readonly cooldownMs?: number;
}): string | undefined {
  const url = new URL(input.href);

  if (input.alreadyAttempted || url.searchParams.has(CHUNK_RELOAD_PARAM)) return undefined;

  if (!chunkReloadAllowed(input.storage, input.now, input.cooldownMs)) return undefined;

  url.searchParams.set(CHUNK_RELOAD_PARAM, "1");

  return url.href;
}

/**
 * Claim the single automatic reload allowed inside `cooldownMs`.
 *
 * The timestamp is written before the caller reloads, so a bundle that is
 * broken even after a reload cannot trap the tab in a refresh loop.
 */
export function chunkReloadAllowed(
  storage: DeploymentStorage | undefined,
  now: number,
  cooldownMs = CHUNK_RELOAD_COOLDOWN_MS,
): boolean {
  const previous = Number(storageValue(storage, CHUNK_RELOAD_KEY));

  if (Number.isFinite(previous) && now - previous < cooldownMs) return false;

  writeStorage(storage, CHUNK_RELOAD_KEY, String(now));

  return true;
}

/**
 * True when a deployment change deserves a notice: there is a build on both
 * sides, it changed, and this tab has not already announced it.
 */
export function shouldAnnounceDeployment(
  storage: DeploymentStorage | undefined,
  currentBuild: string | undefined,
  incomingBuild: string | undefined,
): boolean {
  if (!currentBuild || !incomingBuild || currentBuild === incomingBuild) return false;

  return storageValue(storage, ANNOUNCED_DEPLOYMENT_KEY) !== incomingBuild;
}

/** Remember an announced build so dismissing the notice is final for this tab. */
export function markDeploymentAnnounced(
  storage: DeploymentStorage | undefined,
  build: string,
): void {
  writeStorage(storage, ANNOUNCED_DEPLOYMENT_KEY, build);
}

/**
 * Persist an announcement only once the notice has actually mounted.
 *
 * Polling can observe a build change more than once before render; the
 * in-memory guard handles that without claiming the notice was shown.
 */
export const markDeploymentNoticeShown = (build: string): void => {
  if (typeof window === "undefined") return;

  try {
    markDeploymentAnnounced(window.sessionStorage, build);
  } catch {
    // Storage can be disabled; the in-memory guard still suppresses repeats.
  }
};

/**
 * Forget the announcement when the user acts on it.
 *
 * A reload normally picks up the new deployment immediately, so nothing shows.
 * If an edge-cached document serves the old build again, the next poll is free
 * to show the notice rather than leaving the tab silently stale.
 */
export function clearDeploymentAnnouncement(storage: DeploymentStorage | undefined): void {
  try {
    storage?.removeItem(ANNOUNCED_DEPLOYMENT_KEY);
  } catch {
    // Same storage policy as the rest of this module.
  }
}

const [pendingDeployment, setPendingDeployment] = createSignal<string | null>(null);

/** The deployment waiting behind a reload prompt, or `null` when none. */
export { pendingDeployment };

export const dismissDeploymentNotice = () => setPendingDeployment(null);

export const reloadForDeployment = () => {
  if (typeof window === "undefined") return;

  try {
    clearDeploymentAnnouncement(window.sessionStorage);
  } catch {
    // Storage can be disabled; the reload still happens.
  }

  window.location.reload();
};

let installed = false;

/**
 * Install the listeners that recover from stale chunks and notice new builds.
 *
 * Called from the client entry before hydration so a route chunk that fails
 * during the first navigation is still caught. Re-entrant calls are ignored.
 */
export function installSkewProtection(): void {
  if (installed) return;

  if (typeof window === "undefined" || typeof document === "undefined") return;

  installed = true;

  const storage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return undefined;
    }
  })();

  const meta = document.querySelector(`meta[name="${DEPLOYMENT_META_NAME}"]`);
  let currentBuild = meta?.getAttribute("content")?.trim() || undefined;
  let announcedBuild = storageValue(storage, ANNOUNCED_DEPLOYMENT_KEY);
  let lastCheck = 0;
  let checking = false;

  // A marker left by the previous boot means this document is already the
  // result of the one automatic reload. Strip it from the address bar (so a
  // shared/reloaded URL is clean) while remembering it for this page lifetime.
  const landing = stripChunkReloadMarker(window.location.href);
  let chunkReloadAttempted = landing.attempted;

  if (landing.attempted) {
    try {
      window.history.replaceState(window.history.state, "", landing.url);
    } catch {
      // The marker still prevents a second reload; only the URL stays marked.
    }
  }

  const reloadForChunkError = (): boolean => {
    const target = chunkReloadTarget({
      href: window.location.href,
      storage,
      now: Date.now(),
      alreadyAttempted: chunkReloadAttempted,
    });

    if (!target) return false;

    chunkReloadAttempted = true;
    window.location.replace(target);

    return true;
  };

  const onPreloadError = (event: Event) => {
    const message = preloadFailureMessage(event);

    if (!message || !chunkFailureAssetUrl(message, window.location.origin)) return;

    // Reload first; only suppress Vite's rethrow when a reload is actually
    // taking over. With `defaultPrevented`, Vite resolves the preload promise
    // with `undefined` instead of throwing, which avoids an unhandled error on
    // the document that is about to be replaced.
    if (reloadForChunkError()) event.preventDefault();
  };

  const onError = (event: ErrorEvent) => {
    if (chunkFailureAssetUrl(event.message, window.location.origin)) reloadForChunkError();
  };

  // Resource errors do not bubble. A failed same-origin script or modulepreload
  // under `/assets/` is the last-resort signal for a chunk the browser refused
  // to fetch without an exception. Third-party scripts (analytics, recording)
  // must never trigger a reload.
  const onResourceError = (event: Event) => {
    const target = event.target;

    if (target instanceof HTMLScriptElement) {
      if (isChunkAssetUrl(target.src, window.location.origin)) reloadForChunkError();

      return;
    }

    if (target instanceof HTMLLinkElement && target.rel === "modulepreload") {
      if (isChunkAssetUrl(target.href, window.location.origin)) reloadForChunkError();
    }
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;

    if (reason instanceof Error && chunkFailureAssetUrl(reason.message, window.location.origin))
      reloadForChunkError();
  };

  const pollDeployment = async () => {
    try {
      const response = await fetch("/version", {
        cache: "no-store",
        headers: { accept: "application/json" },
      });

      if (!response.ok) return;

      const body = await response.text().catch(() => undefined);
      const incomingBuild = deploymentIdFromResponse(body, response.headers.get(DEPLOYMENT_HEADER));

      if (!incomingBuild) return;

      // An older cached shell has no build meta. Adopt the first answer as the
      // baseline instead of claiming every deployment is new.
      if (currentBuild === undefined) {
        currentBuild = incomingBuild;

        return;
      }

      if (incomingBuild === currentBuild || incomingBuild === announcedBuild) return;

      if (!shouldAnnounceDeployment(storage, currentBuild, incomingBuild)) return;

      announcedBuild = incomingBuild;
      setPendingDeployment(incomingBuild);
    } catch {
      // Offline or a transient failure: the next poll retries.
    }
  };

  const checkDeployment = () => {
    const now = Date.now();

    if (checking || now - lastCheck < DEPLOYMENT_CHECK_THROTTLE_MS) return;

    lastCheck = now;
    checking = true;
    void pollDeployment().finally(() => {
      checking = false;
    });
  };

  window.addEventListener("vite:preloadError", onPreloadError);
  window.addEventListener("error", onError);
  window.addEventListener("error", onResourceError, true);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  window.addEventListener("online", checkDeployment);
  window.addEventListener("pageshow", (event) => {
    // `pageshow` also fires for the initial load; the 10s hydration delay below
    // owns that case. Only a restored bfcache entry needs an immediate probe.
    if (event.persisted) checkDeployment();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDeployment();
  });

  // Let hydration finish before the first network probe, then check on a slow
  // timer. Focus and visibility changes cover the common long-lived tab.
  window.setTimeout(checkDeployment, 10_000);
  window.setInterval(checkDeployment, DEPLOYMENT_POLL_INTERVAL_MS);
}
