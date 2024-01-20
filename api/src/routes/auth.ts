import { encodeId, newApp, newAuthedApp, withAuth } from "../utils";
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

const authenticatedApp = newAuthedApp()
  .get("/me", (c) => {
    const session = c.env.session.data;
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
      const input = c.req.valid("json");

      // Skip DB if we have nothing to update
      if (input.name !== undefined) {
        const result = await db
          .update(users)
          .set({
            name: input.name,
          })
          .where(eq(users.id, session.id));

        await c.env.session.update({
          ...session,
          name: input.name,
        });
      }

      return c.json({
        id: encodeId("user", session.id),
        name: input.name || session.name,
        email: session.email,
      } satisfies UserResult);
    }
  )
  .post(async (c) => {
    // TODO: Delete session from DB

    await c.env.session.clear();
    return c.json({});
  });

export const app = newApp()
  .post(
    "/login",
    zValidator(
      "json",
      z.object({ email: z.string().email(), password: z.string() })
    ),
    async (c) => {
      const input = c.req.valid("json");

      const name = input.email.split("@")[0] ?? "";

      // TODO: Validate email and don't just auto create new accounts

      const result = await db
        .insert(users)
        .values({ name, email: input.email })
        .onDuplicateKeyUpdate({ set: { email: input.email } });

      // The upsert didn't insert a value and MySQL has no `RETURNING`
      let userId = parseInt(result.insertId);
      if (result.insertId === "0") {
        const user = (
          await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, input.email))
        )?.[0];
        if (!user) throw new Error("Error getting user we just inserted!");
        userId = user.id;
      }

      // TODO: Check credentials with DB
      // TODO: Create session in DB

      await c.env.session.update({ id: userId, name, email: input.email });
      return c.json({});
    }
  )
  .route("/", authenticatedApp);
