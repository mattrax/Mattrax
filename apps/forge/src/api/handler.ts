import { defineEventHandler, toWebRequest, EventHandler } from "vinxi/server";
import { type H3Event, useSession } from "vinxi/server";

import { app } from "~/api/server";
import { env } from "~/env";
import { type GetSessionResult } from "~/api/types";

const handler: EventHandler = defineEventHandler(async (event) =>
  app.fetch(toWebRequest(event), {
    h3Event: event,
    session: await getServerSession(event),
  })
);

export default handler;

export async function getServerSession(event: H3Event) {
  const session = await useSession(event, {
    name: "mattrax-state",
    password: env.AUTH_SECRET,
    cookie: {
      // Safari gets unhappy
      secure: !import.meta.env.DEV,
    },
  });

  return {
    get id() {
      return session.id;
    },
    get data() {
      if (
        typeof session.data === "object" &&
        !Array.isArray(session.data) &&
        Object.keys(session.data).length === 0
      )
        return undefined;
      return session.data;
    },
    update: session.update,
    clear: session.clear,
  } satisfies GetSessionResult;
}
