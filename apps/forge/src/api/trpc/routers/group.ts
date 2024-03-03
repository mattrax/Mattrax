import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createId } from "@paralleldrive/cuid2";
import {
  GroupAssignableVariant,
  GroupAssignableVariants,
  db,
  devices,
  groupAssignableVariants,
  groupAssignables,
  groups,
  users,
} from "~/db";
import { createTRPCRouter, tenantProcedure } from "../helpers";
import { union } from "drizzle-orm/mysql-core";

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
          id: groups.id,
          name: groups.name,
          memberCount: sql`count(${groupAssignables.groupPk})`,
        })
        .from(groups)
        .where(eq(groups.tenantPk, ctx.tenant.pk))
        .leftJoin(groupAssignables, eq(groups.pk, groupAssignables.groupPk))
        .groupBy(groups.pk);
    }),
  create: tenantProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const id = createId();

      await db.insert(groups).values({
        id,
        name: input.name,
        tenantPk: ctx.tenant.pk,
      });

      return id;
    }),

  get: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return getGroup({ groupId: input.id, tenantPk: ctx.tenant.pk });
    }),
  members: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const group = await getGroup({
        groupId: input.id,
        tenantPk: ctx.tenant.pk,
      });
      if (!group)
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      return await db
        .select({
          pk: groupAssignables.pk,
          variant: groupAssignables.variant,
          name: sql<GroupAssignableVariant>`
          	GROUP_CONCAT(
           		CASE
           			WHEN ${groupAssignables.variant} = ${GroupAssignableVariants.device} THEN ${devices.name}
             		WHEN ${groupAssignables.variant} = ${GroupAssignableVariants.user} THEN ${users.name}
             	END
           	)
          `.as("name"),
        })
        .from(groupAssignables)
        .where(eq(groupAssignables.groupPk, group.pk))
        .leftJoin(
          devices,
          and(
            eq(devices.pk, groupAssignables.pk),
            eq(groupAssignables.variant, GroupAssignableVariants.device)
          )
        )
        .leftJoin(
          users,
          and(
            eq(users.pk, groupAssignables.pk),
            eq(groupAssignables.variant, GroupAssignableVariants.user)
          )
        )
        .groupBy(groupAssignables.variant, groupAssignables.pk);
    }),
  possibleMembers: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx }) =>
      union(
        db
          .select({
            name: users.name,
            id: users.id,
            pk: users.pk,
            variant: sql<GroupAssignableVariant>`user`,
          })
          .from(users)
          .where(eq(users.tenantPk, ctx.tenant.pk)),

        db
          .select({
            name: devices.name,
            id: devices.id,
            pk: devices.pk,
            variant: sql<GroupAssignableVariant>`device`,
          })
          .from(devices)
          .where(eq(devices.tenantPk, ctx.tenant.pk))
      )
    ),
  addMembers: tenantProcedure
    .input(
      z.object({
        id: z.string(),
        members: z.array(
          z.object({
            pk: z.number(),
            variant: z.enum(groupAssignableVariants),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const group = await getGroup({
        groupId: input.id,
        tenantPk: ctx.tenant.pk,
      });
      if (!group)
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      await db
        .insert(groupAssignables)
        .values(
          input.members.map((member) => ({
            groupPk: group.pk,
            pk: member.pk,
            variant: member.variant,
          }))
        )
        .onDuplicateKeyUpdate({
          set: { groupPk: sql`${groupAssignables.groupPk}` },
        });
    }),
});
