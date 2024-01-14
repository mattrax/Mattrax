import { useSession } from "@solidjs/start/server";
import { getRequestEvent } from "solid-js/web";
import { env } from "~/env";

export const getSession = () => {
  const event = getRequestEvent();
  if (!event) throw new Error("Unable to get 'getRequestEvent'");
  return useSession(event, {
    name: "s",
    password: env.SESSION_SECRET,
  });
};
