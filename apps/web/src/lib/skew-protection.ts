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

const CHUNK_RELOAD_COOLDOWN_MS = 60_000;

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
  let lastChunkReload = 0;
  let lastCheck = 0;
  let checking = false;

  const reloadForChunkError = () => {
    const now = Date.now();

    // The storage timestamp is the cross-reload guard; this one covers
    // deployments where storage is unavailable.
    if (now - lastChunkReload < CHUNK_RELOAD_COOLDOWN_MS) return;

    if (!chunkReloadAllowed(storage, now)) return;

    lastChunkReload = now;
    window.location.reload();
  };

  const onPreloadError = (event: Event) => {
    // Vite throws the rejection after dispatching this event; preventing the
    // default keeps the console clean while the reload takes over.
    event.preventDefault();
    reloadForChunkError();
  };

  const onError = (event: ErrorEvent) => {
    if (isChunkLoadFailure(event.message)) reloadForChunkError();
  };

  // Resource errors do not bubble. A failed same-origin script under `/assets/`
  // is the last-resort signal for a chunk the browser refused to fetch without
  // an exception. Third-party scripts (analytics, recording) must never trigger
  // a reload.
  const onResourceError = (event: Event) => {
    const target = event.target;

    if (!(target instanceof HTMLScriptElement)) return;

    try {
      const source = new URL(target.src, window.location.href);

      if (source.origin !== window.location.origin || !source.pathname.startsWith("/assets/"))
        return;
    } catch {
      return;
    }

    reloadForChunkError();
  };

  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;

    if (reason instanceof Error && isChunkLoadFailure(reason.message)) reloadForChunkError();
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
      markDeploymentAnnounced(storage, incomingBuild);
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
  window.addEventListener("pageshow", checkDeployment);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkDeployment();
  });

  // Let hydration finish before the first network probe, then check on a slow
  // timer. Focus and visibility changes cover the common long-lived tab.
  window.setTimeout(checkDeployment, 10_000);
  window.setInterval(checkDeployment, DEPLOYMENT_POLL_INTERVAL_MS);
}
