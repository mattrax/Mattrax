# trpc-server-function

An alternative tRPC link that streams results over a SolidStart server function.

## Setup

1. Install required dependencies `@solid-mediakit/trpc @tanstack/solid-query`

2. Create the server function, which will need your tRPC router and context function
```ts
import {
  type TrpcServerFunctionOpts,
  createServerFunctionLink,
  seroval,
  trpcServerFunction,
} from "@mattrax/trpc-server-function";
import { router, createContext } from "...";

function serverFunction(opts: TrpcServerFunctionOpts) {
  "use server";

  return trpcServerFunction({ router, createContext, opts });
}
```

3. Add the `seroval` transformer and server function link to your client
```ts
import { seroval } from "@mattrax/trpc-server-function";

export const trpc = createTRPCSolidStart<AppRouter>({
  config: () => ({
    links: [createServerFunctionLink(serverFunction)],
    transformer: seroval,
  }),
});
```

4. Add the `seroval` transformer to your tRPC builder
```ts
import { seroval } from "@mattrax/trpc-server-function";

const t = initTRPC.context().create({
  transformer: seroval
})
```

## Response Flushing

After the response stream is sent to the client, headers and other request metadata cannot be modified.
To get around this, the stream will not be sent to the client until every procedure in the batch has called `flushResponse`.
In Mattrax, we flush manually in public procedures so that auth-related mutations can send headers,
and manually in protected procedures after authentication completes, since we have many more protected procedures than public ones.
That is done [here](/apps/web/src/api/trpc/helpers.ts), but here's a small example:

```ts
import { flushResponse } from "@mattrax/trpc-server-function/server";

export const publicProcedure = t.procedure.use(async ({ next }) => 
  next().catch(e => {
    flushResponse();
    throw e;
  })
)

export const protectedProcedure = t.procedure.use(async ({ next }) => {
  const auth = await checkAuth().catch(e => {
    flushResponse();
    throw e;
  });

  flushResponse();

  await next({ ctx: { auth } });
})
```
