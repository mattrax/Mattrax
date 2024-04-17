import {
  TrpcServerFunctionOpts,
  createServerFunctionLink,
  seroval,
  trpcServerFunction,
} from "@mattrax/trpc-server-function";
import { createTRPCSolidStart } from "@solid-mediakit/trpc";
import { router, createContext, AppRouter } from "~/api/trpc";

function serverFunction(opts: TrpcServerFunctionOpts) {
  "use server";

  return trpcServerFunction({ router, createContext, opts });
}

export const trpc = createTRPCSolidStart<AppRouter>({
  config: () => ({
    links: [createServerFunctionLink(serverFunction)],
    transformer: seroval,
  }),
});
