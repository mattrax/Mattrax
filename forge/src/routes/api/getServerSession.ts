import { GetSessionResult, env } from "@mattrax/api";
import { type H3Event, useSession } from "vinxi/server";

export const getServerSession = async (event: H3Event) => {
  const session = await useSession(event, {
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
