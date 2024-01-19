import { encodeId, newApp, withAuth } from "../utils";
import z from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

type UserResult = {
  id: string;
  name: string;
  email: string;
};

export const app = newApp()
  .use(withAuth)
  .get("/me", (c) => {
    const session = c.env.session.data;
    if (!session) throw new Error("todo: handle this"); // TODO: Handle unauthenticated
    return c.json({
      id: encodeId("user", session.id),
      name: session.name,
      email: session.email,
    } satisfies UserResult);
  })
  .post(
    "/update",
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
      })
    ),
    async (c) => {
      const session = c.env.session.data;
      if (!session) throw new Error("todo: handle this"); // TODO: Handle unauthenticated

      const data = c.req.valid("json");

      // Skip DB if we have nothing to update
      if (data.name !== undefined) {
        const result = await db
          .update(users)
          .set({
            name: data.name,
          })
          .where(eq(users.id, session.id));

        await c.env.session.update({
          ...session,
          name: data.name,
        });
      }

      return c.json({
        id: encodeId("user", session.id),
        name: data.name || session.name,
        email: session.email,
      } satisfies UserResult);
    }
  );

// TODO: Logout
