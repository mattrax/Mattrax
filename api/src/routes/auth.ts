import { encodeId, newUnauthenticatedApp, newApp, withAuth } from "../utils";
import z from "zod";
import { zValidator } from "@hono/zod-validator";
import { db } from "../db";
import { tenants, accounts } from "../db/schema";
import { eq } from "drizzle-orm";

type UserResult = {
  id: string;
  name: string;
  email: string;
  tenants: Awaited<ReturnType<typeof fetchTenants>>;
};

const fetchTenants = async (session_id: number) =>
  (
    await db
      .select({
        id: tenants.id,
        name: tenants.name,
      })
      .from(tenants)
      .where(eq(tenants.owner_id, session_id))
  ).map((tenant) => ({
    ...tenant,
    id: encodeId("tenant", tenant.id),
  }));

const authenticatedApp = newApp()
  .get("/me", async (c) => {
    const session = c.env.session.data;
    return c.json({
      id: encodeId("user", session.id),
      name: session.name,
      email: session.email,
      tenants: await fetchTenants(session.id),
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
          .update(accounts)
          .set({
            name: input.name,
          })
          .where(eq(accounts.id, session.id));

        await c.env.session.update({
          ...session,
          name: input.name,
        });
      }

      return c.json({
        id: encodeId("user", session.id),
        name: input.name || session.name,
        email: session.email,
        tenants: await fetchTenants(session.id),
      } satisfies UserResult);
    }
  )
  .post(async (c) => {
    // TODO: Delete session from DB

    await c.env.session.clear();
    return c.json({});
  });

export const app = newUnauthenticatedApp()
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
        .insert(accounts)
        .values({ name, email: input.email })
        .onDuplicateKeyUpdate({ set: { email: input.email } });

      // The upsert didn't insert a value and MySQL has no `RETURNING`
      let userId = parseInt(result.insertId);
      if (result.insertId === "0") {
        const user = (
          await db
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.email, input.email))
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
