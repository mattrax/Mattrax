export type PostHogBrowserConfig = {
  readonly key: string;
  readonly host: string;
  /** `production`, `preview` or `development`; matches the API's environment tag. */
  readonly environment?: string;
  /** Deployment that served the document, attached to every browser event. */
  readonly release?: string;
  readonly deploymentId?: string;
};

/** Classify the public host so browser and server events share one filter. */
export const postHogEnvironment = (hostname: string): string => {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost"))
    return "development";

  if (hostname.endsWith(".workers.dev")) return "preview";

  return "production";
};

const configs = new WeakMap<Request, PostHogBrowserConfig>();

/** Store the public PostHog config for the current document render. */
export const setPostHogConfig = (request: Request, config: PostHogBrowserConfig): void => {
  configs.set(request, config);
};

export const getPostHogConfig = (request: Request): PostHogBrowserConfig | undefined =>
  configs.get(request);
