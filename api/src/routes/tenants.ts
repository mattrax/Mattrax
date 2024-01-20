import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { tenants, db } from "../db";
import { encodeId, newAuthedApp } from "../utils";

export const app = newAuthedApp().post(
  "/create",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(100),
    })
  ),
  async (c) => {
    const input = c.req.valid("json");
    const result = await db.insert(tenants).values({
      name: input.name,
      owner_id: c.env.session.data.id,
    });

    // TODO: Invalidate `tenants`

    return c.json({
      id: encodeId("tenant", parseInt(result.insertId)),
    });
  }
);
