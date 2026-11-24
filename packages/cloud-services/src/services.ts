/**
 * The hosted Mattrax services deployment.
 *
 * Every hosted endpoint an application deployment talks to (the APNs relay and
 * deployment licensing) lives behind this one origin. The origin is an internal
 * default rather than operator configuration: Cloud and self-hosted installs
 * both reach the hosted deployment, and only tests or preview deployments
 * override it through `MATTRAX_SERVICES_URL`.
 */
export const DEFAULT_SERVICES_URL = "https://services.mattrax.app";

export type ServicesUrls = {
  /** Canonical origin, without a trailing slash. */
  readonly origin: string;
  /** `POST /v1/apns/push` on the hosted APNs relay. */
  readonly apnsRelay: string;
  /** Base origin for deployment licensing and hosted billing calls. */
  readonly billing: string;
};

const parseServicesUrl = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("MATTRAX_SERVICES_URL must be an https: URL");
  }

  if (url.protocol !== "https:") throw new Error("MATTRAX_SERVICES_URL must be an https: URL");

  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("MATTRAX_SERVICES_URL must be an origin without a path, query or credentials");

  return url.origin;
};

/**
 * Derive every hosted endpoint from the single services origin. Passing an
 * empty value (the Worker's default text binding) selects the hosted
 * deployment; a trailing slash is normalised so paths are never doubled. An
 * override must be an `https:` origin with no path, query or credentials.
 */
export const servicesUrls = (override?: string | null): ServicesUrls => {
  const origin = parseServicesUrl(override?.trim() || DEFAULT_SERVICES_URL);

  return {
    origin,
    apnsRelay: new URL("/v1/apns/push", origin).toString(),
    billing: origin,
  };
};
