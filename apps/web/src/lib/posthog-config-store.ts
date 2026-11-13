export type PostHogBrowserConfig = {
  readonly key: string;
  readonly host: string;
};

const configs = new WeakMap<Request, PostHogBrowserConfig>();

/** Store the public PostHog config for the current document render. */
export const setPostHogConfig = (request: Request, config: PostHogBrowserConfig): void => {
  configs.set(request, config);
};

export const getPostHogConfig = (request: Request): PostHogBrowserConfig | undefined =>
  configs.get(request);
