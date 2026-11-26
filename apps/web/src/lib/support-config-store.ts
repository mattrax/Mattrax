import { getRequestEvent, isServer } from "@solidjs/web";

export type SupportBrowserConfig = {
  /** A calendar booking page, support form or mailto: link. */
  readonly url: string;
};

/**
 * The safe fallback. It is a mailto so every deployment has a working support
 * link even when no support or calendar URL is configured.
 */
export const DEFAULT_SUPPORT_URL = "mailto:hello@mattrax.app?subject=Mattrax%20support";

const SUPPORT_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/**
 * Accept only URLs that a link can safely open. An invalid or relative value
 * falls back to the default rather than rendering a dead or script link.
 */
export const resolveSupportUrl = (configured: string | undefined): string => {
  const value = configured?.trim();

  if (!value) return DEFAULT_SUPPORT_URL;

  try {
    return SUPPORT_PROTOCOLS.has(new URL(value).protocol) ? value : DEFAULT_SUPPORT_URL;
  } catch {
    return DEFAULT_SUPPORT_URL;
  }
};

const configs = new WeakMap<Request, SupportBrowserConfig>();

/** Store the deployment support URL for the current document render. */
export const setSupportConfig = (request: Request, config: SupportBrowserConfig): void => {
  configs.set(request, config);
};

export const getSupportConfig = (request: Request): SupportBrowserConfig | undefined =>
  configs.get(request);

/**
 * The support link used by the account menu and the onboarding checklist.
 *
 * The server reads the request-scoped configuration; the browser reads the
 * value the document injected before hydration, so both renders agree and a
 * configured calendar URL never flashes back to the mailto fallback.
 */
export const supportUrl = (): string => {
  if (isServer) {
    const request = getRequestEvent()?.request;

    return resolveSupportUrl(request ? getSupportConfig(request)?.url : undefined);
  }

  return resolveSupportUrl(
    typeof window === "undefined" ? undefined : window.__MATTRAX_SUPPORT__?.url,
  );
};
