import { defineEventHandler, toWebRequest, EventHandler } from "vinxi/server";

import { app } from "~/api/server";

const handler: EventHandler = defineEventHandler(async (event) =>
  app.fetch(toWebRequest(event), {
    h3Event: event,
  })
);

export default handler;
