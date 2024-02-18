import type { AppRouter } from "@mattrax/api";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import {
  createTRPCSolidStart,
  type CreateTRPCSolidStart,
} from "@solid-mediakit/trpc";
import superjson from "superjson";
import {
  Accessor,
  createContext,
  createEffect,
  createSignal,
  ParentProps,
  useContext,
} from "solid-js";
import { makePersisted } from "@solid-primitives/storage";

const Context = createContext<{
  client: CreateTRPCSolidStart<AppRouter>;
  tenantId: Accessor<string | undefined>;
  setTenantId: (id: string | undefined) => void;
}>(undefined!);

// TODO: I am guessing this approach will still not work well with Suspense but it's better than what we had before.
// TODO: When tenant switches in a transition I assume Solid "clones" only the suspending area but it will call `setTenantId` which will modify both tree's causing invalid state.
export function TrpcProvider(props: ParentProps) {
  const [tenantId, setTenantId] = makePersisted(
    createSignal<string | undefined>(undefined),
    { name: "x-tenant-id" }
  );

  const trpc = createTRPCSolidStart({
    config: () => ({
      links: [
        httpBatchLink({
          url: `${location.origin}/api/trpc`,
          headers: () =>
            tenantId() !== undefined ? { "x-tenant-id": tenantId() } : {},
        }),
      ],
      transformer: superjson,
    }),
  });

  return (
    <Context.Provider
      value={{
        client: trpc as any,
        tenantId,
        setTenantId,
      }}
    >
      {props.children}
    </Context.Provider>
  );
}

export const trpc: CreateTRPCSolidStart<AppRouter> = new Proxy<any>(
  {},
  {
    get(_, prop) {
      const ctx = useContext(Context);
      if (!ctx) throw new Error("Forgot `TrpcProvider`?");
      // @ts-expect-error
      return ctx.client[prop];
    },
  }
);

export function useTenantId() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Forgot `TrpcProvider`?");
  return ctx.tenantId;
}

export function setTenantId(id: string | undefined) {
  console.log(id);
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Forgot `TrpcProvider`?");
  ctx.setTenantId(id);
}

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
  cause: unknown
): cause is TRPCClientError<AppRouter> {
  return cause instanceof TRPCClientError;
}

export const isDebugMode = () => localStorage.getItem("mttxDebug") === "1";
