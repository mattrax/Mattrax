/// <reference types="vite/client" />

interface Window {
  /** Public PostHog config injected by the SSR shell. */
  __MATTRAX_POSTHOG__?: {
    key: string;
    host: string;
  };
}
