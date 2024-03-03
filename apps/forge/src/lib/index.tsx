import {
  type CreateTRPCSolidStart,
  createTRPCSolidStart,
} from "@solid-mediakit/trpc";
import { TRPCClientError, httpBatchLink } from "@trpc/client";
import { type ClassValue, clsx } from "clsx";
import { Accessor, createEffect, createSignal } from "solid-js";
import superjson from "superjson";
import { twMerge } from "tailwind-merge";
import type { AppRouter } from "~/api";

export const trpc: CreateTRPCSolidStart<AppRouter> = createTRPCSolidStart({
  config: () => ({
    links: [
      httpBatchLink({
        url: `${location.origin}/api/trpc`,
      }),
    ],
    transformer: superjson,
  }),
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// TODO: Surly this can be done in a better way.
export function untrackScopeFromSuspense<T>(scope: () => T): Accessor<T> {
  const [signal, setSignal] = createSignal<T>(scope());
  createEffect(() => setSignal(scope() as any));
  return signal;
}

export function SuspenseError(props: { name: string }) {
  // Hitting the certain higher-level suspense boundaries means we don't have a UI to show which is a bad UI so we log the warning.
  console.warn(`${props.name}Suspense triggered!`);
  return <></>;
}

// https://trpc.io/docs/client/vanilla/infer-types#infer-trpcclienterror-types
export function isTRPCClientError(
  cause: unknown,
): cause is TRPCClientError<AppRouter> {
  return cause instanceof TRPCClientError;
}

export const isDebugMode = () => localStorage.getItem("mttxDebug") === "1";
