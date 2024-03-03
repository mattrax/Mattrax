import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createId } from "@paralleldrive/cuid2";
import { promiseAllObject } from "~/api/utils";
import {
  db,
  devices,
  groupAssignableVariants,
  groupAssignables,
  groups,
  users,
} from "~/db";
import { createTRPCRouter, tenantProcedure } from "../helpers";

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

      return await promiseAllObject({
        users: db
          .select({ pk: users.pk, id: users.id, name: users.name })
          .from(users)
          .leftJoin(
            groupAssignables,
            eq(users.pk, groupAssignables.groupablePk),
          )
          .where(
            and(
              eq(groupAssignables.groupableVariant, "user"),
              eq(groupAssignables.groupPk, group.pk),
            ),
          )
          .then((r) => r || []),
        devices: db
          .select({ pk: devices.pk, id: devices.id, name: devices.name })
          .from(devices)
          .leftJoin(
            groupAssignables,
            eq(devices.pk, groupAssignables.groupablePk),
          )
          .where(
            and(
              eq(groupAssignables.groupableVariant, "device"),
              eq(groupAssignables.groupPk, group.pk),
            ),
          )
          .then((r) => r || []),
      });
    }),
  possibleMembers: tenantProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx }) =>
      promiseAllObject({
        users: db.query.users
          .findMany({
            where: eq(users.tenantPk, ctx.tenant.pk),
            columns: { name: true, id: true, pk: true },
          })
          .then((r) => r || []),
        devices: db.query.devices
          .findMany({
            where: eq(devices.tenantPk, ctx.tenant.pk),
            columns: { name: true, id: true, pk: true },
          })
          .then((r) => r || []),
      }),
    ),
  addMembers: tenantProcedure
    .input(
      z.object({
        id: z.string(),
        members: z.array(
          z.object({
            pk: z.number(),
            variant: z.enum(groupAssignableVariants),
          }),
        ),
      }),
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
            groupablePk: member.pk,
            groupableVariant: member.variant,
          })),
        )
        .onDuplicateKeyUpdate({
          set: { groupPk: sql`${groupAssignables.groupPk}` },
        });
    }),
});
