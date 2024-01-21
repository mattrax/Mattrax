import { useSession as useSolidSession } from "@solidjs/start/server";
import { GetSessionResult, env } from "@mattrax/api";
import { getRequestEvent } from "solid-js/web";

export const getServerSession = async () => {
  const event = getRequestEvent();
  if (!event) throw new Error("Unable to get 'getRequestEvent'");
  const session = await useSolidSession(event, {
    name: "s",
    password: env.AUTH_SECRET,
    cookie: {
      // Safari gets unhappy
      secure: !import.meta.env.DEV,
    },
  });

  var obj: Record<string, unknown> = {};
  Object.defineProperty(obj, "id", {
    get: () => session.id,
  });
  Object.defineProperty(obj, "data", {
    get: () => {
      // We don't wanna return an empty object `{}`
      if (
        typeof session.data === "object" &&
        !Array.isArray(session.data) &&
        Object.keys(session.data).length === 0
      )
        return undefined;
      return session.data;
    },
  });
  obj.update = session.update;
  obj.clear = session.clear;

  return obj as any as GetSessionResult;
};
