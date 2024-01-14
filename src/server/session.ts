import { redirect } from "@solidjs/router";
import { useSession as useSolidSession } from "@solidjs/start/server";
import { createContext, useContext } from "solid-js";
import { getRequestEvent } from "solid-js/web";
import { env } from "~/env";
import { db } from "./db";
import { tenants } from "./db/schema";
import { eq } from "drizzle-orm";

export async function dashboardLayoutLoader() {
  "use server";

  const session = await getServerSession();
  // TODO: This `redirect` is broken
  if (!session?.data) throw redirect("/login");

  return {
    session: {
      id: session.data.id,
      name: session.data.name,
      email: session.data.email,
    },
    tenants: await db
      .select({
        id: tenants.id,
        name: tenants.name,
      })
      .from(tenants)
      .where(eq(tenants.owner_id, session.data.id)),
  };
}

export const sessionCtx = createContext<
  Required<Awaited<ReturnType<typeof dashboardLayoutLoader>>>
>(undefined!);

type SessionData = {
  id: number;
  name: string;
  email: string;
};

type GetSessionResult = {
  readonly id: string | undefined;
  readonly data: SessionData | undefined;
  update: (data: SessionData) => Promise<void>;
  clear: () => Promise<void>;
};

export const getServerSession = () => {
  const event = getRequestEvent();
  if (!event) throw new Error("Unable to get 'getRequestEvent'");
  return useSolidSession(event, {
    name: "s",
    password: env.AUTH_SECRET,
  }) as any as Promise<GetSessionResult>;
};

export const useSession = () => {
  const session = useContext(sessionCtx);
  if (!session) throw redirect("/login");
  return session;
};
