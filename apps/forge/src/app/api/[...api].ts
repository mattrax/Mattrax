import { defineEventHandler, toWebRequest, EventHandler } from "vinxi/server";
import { app } from "@mattrax/api/server";
import { getServerSession } from "./getServerSession";

const handler: EventHandler = defineEventHandler(async (event) =>
  app.fetch(toWebRequest(event), {
    h3Event: event,
    session: await getServerSession(event),
  })
);

export default handler;
