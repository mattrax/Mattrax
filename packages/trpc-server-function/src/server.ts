import { getEvent } from "vinxi/http";

export const TRPC_REQUEST = Symbol("tRPC Request");

export function flushResponse() {
  const ctx = (getEvent() as any)[TRPC_REQUEST];
  if (!ctx)
    throw new Error("Cannot call flushResponse outside of a trpc handler");

  ctx.flush();
}
