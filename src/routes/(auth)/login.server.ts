"use server";

import { redirect } from "@solidjs/router";
import { email, object, string } from "valibot";
import { validatedAction } from "~/server/action";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { getServerSession } from "~/server/session";

const loginSchema = object({
  email: string([email()]),
  password: string([]),
});

export const loginAction = validatedAction(loginSchema, async (input) => {
  const session = await getServerSession();

  const name = input.email.split("@")[0] ?? "";

  // TODO: Validate email and don't just auto create new accounts
  const result = await db
    .insert(users)
    .values({ name, email: input.email })
    .onDuplicateKeyUpdate({ set: { email: input.email } });
  const userId = parseInt(result.insertId);

  // TODO: Check credentials

  // TODO: Create session in DB

  await session.update({ id: userId, name, email: input.email });
  throw redirect("/");
});
