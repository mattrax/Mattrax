"use server";

import { redirect } from "@solidjs/router";
import { eq } from "drizzle-orm";
import { email, object, string } from "valibot";
import { unauthenticatedValidatedAction } from "~/server/action";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { getServerSession } from "~/server/session";

const loginSchema = object({
  email: string([email()]),
  password: string([]),
});

export const loginAction = unauthenticatedValidatedAction(
  loginSchema,
  async (input) => {
    const session = await getServerSession();

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

    // TODO: Check credentials

    // TODO: Create session in DB

    await session.update({ id: userId, name, email: input.email });
    throw redirect("/");
  }
);
