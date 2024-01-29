import { initTRPC } from "@trpc/server";
import { z } from "zod";

const t = initTRPC.meta<{ method: "GET" | "POST"; url: string }>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

const appRouter = router({
  normal: publicProcedure
    .meta({ method: "GET", url: "/normal" })
    .query(({ input }) => {
      return { hello: "world" };
    }),

  withInput: publicProcedure
    .input(z.string())
    .meta({ method: "GET", url: "/withInput" })
    .query(({ input }) => {
      return { hello: "world" };
    }),

  // TODO: Support nested routers
});

// TODO: Register all endpoints
Object.entries(appRouter._def.procedures).forEach(
  ([procedureName, procedure]) => {
    const meta = procedure._def.meta;
    console.log(procedureName, meta);
  }
);

export type AppRouter = typeof appRouter;

// TODO: Remove this function. I'm just failing with the Typescript compiler API.
export function testing(): AppRouter {
  return undefined as any;
}
