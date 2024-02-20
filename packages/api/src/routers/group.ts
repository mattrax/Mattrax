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

function getGroup(args: { groupId: number; tenantId: number }) {
  return db.query.groups.findFirst({
    where: and(eq(groups.pk, args.groupId), eq(groups.tenantId, args.tenantId)),
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
          memberCount: sql`count(${groupGroupables.groupId})`,
        })
        .from(groups)
        .where(eq(groups.tenantId, ctx.tenantId))
        .leftJoin(groupGroupables, eq(groups.pk, groupGroupables.groupId))
        .groupBy(groups.pk);
    }),
  create: tenantProcedure
    .input(
      z.object({
        name: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await db.insert(groups).values({
        name: input.name,
        tenantId: ctx.tenantId,
      });
      const insertId = parseInt(result.insertId);

      return insertId;
    }),

  get: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(({ ctx, input }) => {
      return getGroup({ groupId: input.id, tenantId: ctx.tenantId });
    }),
  members: tenantProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const group = await getGroup({
        groupId: input.id,
        tenantId: ctx.tenantId,
      });
      if (!group)
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      const results = await Promise.all([
        db
          .select({ id: users.pk, name: users.name })
          .from(users)
          .leftJoin(groupGroupables, eq(users.pk, groupGroupables.groupableId))
          .where(
            and(
              eq(groupGroupables.groupableVariant, "user"),
              eq(groupGroupables.groupId, group.id)
            )
          ),
        db
          .select({ id: devices.pk, name: devices.name })
          .from(devices)
          .leftJoin(
            groupGroupables,
            eq(devices.pk, groupGroupables.groupableId)
          )
          .where(
            and(
              eq(groupGroupables.groupableVariant, "device"),
              eq(groupGroupables.groupId, group.id)
            )
          ),
        db
          .select({ id: policies.pk, name: policies.name })
          .from(policies)
          .leftJoin(
            groupGroupables,
            eq(policies.pk, groupGroupables.groupableId)
          )
          .where(
            and(
              eq(groupGroupables.groupableVariant, "policy"),
              eq(groupGroupables.groupId, group.id)
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
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx }) => {
      const results = await Promise.all([
        db.query.users.findMany({
          where: eq(users.tenantId, ctx.tenantId),
          columns: { name: true, id: true },
        }),
        db.query.devices.findMany({
          where: eq(devices.tenantId, ctx.tenantId),
          columns: { name: true, id: true },
        }),
        db.query.policies.findMany({
          where: eq(policies.tenantId, ctx.tenantId),
          columns: { name: true, id: true },
        }),
      ]);

      return { users: results[0], devices: results[1], policies: results[2] };
    }),
  addMembers: tenantProcedure
    .input(
      z.object({
        id: z.number(),
        members: z.array(
          z.object({
            id: z.number(),
            variant: z.enum(groupableVariants),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const group = await getGroup({
        groupId: input.id,
        tenantId: ctx.tenantId,
      });
      if (!group)
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      await db
        .insert(groupables)
        .values(
          input.members.map((member) => ({
            id: member.id,
            variant: member.variant,
            tenantId: ctx.tenantId,
          }))
        )
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });

      await db.insert(groupGroupables).values(
        input.members.map((member) => ({
          groupId: group.id,
          groupableId: member.id,
          groupableVariant: member.variant,
        }))
      );
    }),
});
