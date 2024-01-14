import { useSession } from "@solidjs/start/server";
import { getRequestEvent } from "solid-js/web";

export const getSession = () => {
  const event = getRequestEvent();
  if (!event) throw new Error("No request event");
  return useSession(event, {
    password: "areallylongsecretthatyoushouldreplace", // TODO: T3 env process.env.SESSION_SECRET,
  });
};
