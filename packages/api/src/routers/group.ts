import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, tenantProcedure } from "../trpc";
import {
  db,
  devices,
  groupGroupables,
  groupableVariants,
  groupables,
  groups,
  policies,
  users,
} from "../db";

function getGroup(args: { groupId: string; tenantPk: number }) {
  return db.query.groups.findFirst({
    where: and(eq(groups.id, args.groupId), eq(groups.tenantPk, args.tenantPk)),
  });
}

export const groupRouter = createTRPCRouter({
  list: tenantProcedure
    // .input(
    //   z.object({
    //     // TODO: Constrain offset and limit to specific max/min values
    //     offset: z.number().default(0),
    //     limit: z.number().default(50),
    //     // query: z.string().optional(),
    //   })
    // )
    .query(async ({ ctx, input }) => {
      // TODO: Full-text search???
      // TODO: Pagination abstraction
      // TODO: Can a cursor make this more efficent???
      // TODO: Switch to DB

      return await db
        .select({
          id: groups.pk,
          name: groups.name,
          memberCount: sql`count(${groupGroupables.groupPk})`,
        })
        .from(groups)
        .where(eq(groups.tenantPk, ctx.tenantPk))
        .leftJoin(groupGroupables, eq(groups.pk, groupGroupables.groupPk))
        .groupBy(groups.pk);
    }),
  create: tenantProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(groups).values({
        name: input.name,
        tenantPk: ctx.tenantPk,
      });
      const insertId = parseInt(result.insertId);

      return insertId;
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return getGroup({ groupId: input.id, tenantPk: ctx.tenantPk });
    }),
  members: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const group = await getGroup({
        groupId: input.id,
        tenantPk: ctx.tenantPk,
      });
      if (!group)
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      const results = await Promise.all([
        db
          .select({ pk: users.pk, id: users.id, name: users.name })
          .from(users)
          .leftJoin(groupGroupables, eq(users.pk, groupGroupables.groupablePk))
          .where(
            and(
              eq(groupGroupables.groupableVariant, "user"),
              eq(groupGroupables.groupPk, group.pk)
            )
          ),
        db
          .select({ pk: devices.pk, id: devices.id, name: devices.name })
          .from(devices)
          .leftJoin(
            groupGroupables,
            eq(devices.pk, groupGroupables.groupablePk)
          )
          .where(
            and(
              eq(groupGroupables.groupableVariant, "device"),
              eq(groupGroupables.groupPk, group.pk)
            )
          ),
        db
          .select({ pk: policies.pk, id: policies.id, name: policies.name })
          .from(policies)
          .leftJoin(
            groupGroupables,
            eq(policies.pk, groupGroupables.groupablePk)
          )
          .where(
            and(
              eq(groupGroupables.groupableVariant, "policy"),
              eq(groupGroupables.groupPk, group.pk)
            )
          ),
      ]);

      return {
        users: results[0],
        devices: results[1],
        policies: results[2],
      };
    }),
  possibleMembers: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx }) => {
      const results = await Promise.all([
        db.query.users.findMany({
          where: eq(users.tenantPk, ctx.tenantPk),
          columns: { name: true, id: true, pk: true },
        }),
        db.query.devices.findMany({
          where: eq(devices.tenantPk, ctx.tenantPk),
          columns: { name: true, id: true, pk: true },
        }),
        db.query.policies.findMany({
          where: eq(policies.tenantPk, ctx.tenantPk),
          columns: { name: true, id: true, pk: true },
        }),
      ]);

      return { users: results[0], devices: results[1], policies: results[2] };
    }),
  addMembers: tenantProcedure
    .input(
      z.object({
        id: z.string(),
        members: z.array(
          z.object({
            pk: z.number(),
            variant: z.enum(groupableVariants),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const group = await getGroup({
        groupId: input.id,
        tenantPk: ctx.tenantPk,
      });
      if (!group)
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      await db
        .insert(groupables)
        .values(
          input.members.map((member) => ({
            pk: member.pk,
            variant: member.variant,
            tenantPk: ctx.tenantPk,
          }))
        )
        .onDuplicateKeyUpdate({ set: { pk: sql`id` } });

      await db.insert(groupGroupables).values(
        input.members.map((member) => ({
          groupPk: group.pk,
          groupablePk: member.pk,
          groupableVariant: member.variant,
        }))
      );
    }),
});
