declare global {
  interface Env {
    readonly API: { fetch(request: Request): Promise<Response> };
    readonly AUTH_SECRET?: string;
    readonly API_URL?: string;
    readonly POSTHOG_KEY?: string;
    readonly POSTHOG_HOST?: string;
    readonly SUPPORT_URL?: string;
  }
}

export {};
