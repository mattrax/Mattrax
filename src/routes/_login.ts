"use server";

import { redirect } from "@solidjs/router";
import { email, object, string } from "valibot";
import { validatedAction } from "~/server/action";
import { getSession } from "~/server/session";

const loginSchema = object({
  email: string([email()]),
  password: string([]),
});

export const loginAction = validatedAction(loginSchema, async (input) => {
  const session = await getSession();

  // TODO: Check credentials
  // TODO: Create session

  await session.update({ email: input["email"] });

  throw redirect("/");
});
