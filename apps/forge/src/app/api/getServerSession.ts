import { type GetSessionResult, env } from "@mattrax/api";
import { type H3Event, useSession } from "vinxi/server";

export const getServerSession = async (event: H3Event) => {
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
};
