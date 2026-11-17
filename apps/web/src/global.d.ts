/// <reference types="vite/client" />

/** Replaced at build time by `vite.config.ts`; read through `~/lib/deployment`. */
declare const __MATTRAX_BUILD_ID__: string;

interface Window {
  /** Public PostHog config injected by the SSR shell. */
  __MATTRAX_POSTHOG__?: {
    key: string;
    host: string;
  };
}
