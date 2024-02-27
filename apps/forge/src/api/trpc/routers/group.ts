import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, tenantProcedure } from "../helpers";
import {
  db,
  devices,
  groupAssignable,
  groupableVariants,
  groups,
  policies,
  users,
} from "~/db";
import { createId } from "@paralleldrive/cuid2";

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
          memberCount: sql`count(${groupAssignable.groupPk})`,
        })
        .from(groups)
        .where(eq(groups.tenantPk, ctx.tenant.pk))
        .leftJoin(groupAssignable, eq(groups.pk, groupAssignable.groupPk))
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

      const results = await Promise.all([
        db
          .select({ pk: users.pk, id: users.id, name: users.name })
          .from(users)
          .leftJoin(groupAssignable, eq(users.pk, groupAssignable.groupablePk))
          .where(
            and(
              eq(groupAssignable.groupableVariant, "user"),
              eq(groupAssignable.groupPk, group.pk)
            )
          ),
        db
          .select({ pk: devices.pk, id: devices.id, name: devices.name })
          .from(devices)
          .leftJoin(
            groupAssignable,
            eq(devices.pk, groupAssignable.groupablePk)
          )
          .where(
            and(
              eq(groupAssignable.groupableVariant, "device"),
              eq(groupAssignable.groupPk, group.pk)
            )
          ),
        db
          .select({ pk: policies.pk, id: policies.id, name: policies.name })
          .from(policies)
          .leftJoin(
            groupAssignable,
            eq(policies.pk, groupAssignable.groupablePk)
          )
          .where(
            and(
              eq(groupAssignable.groupableVariant, "policy"),
              eq(groupAssignable.groupPk, group.pk)
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
          where: eq(users.tenantPk, ctx.tenant.pk),
          columns: { name: true, id: true, pk: true },
        }),
        db.query.devices.findMany({
          where: eq(devices.tenantPk, ctx.tenant.pk),
          columns: { name: true, id: true, pk: true },
        }),
        db.query.policies.findMany({
          where: eq(policies.tenantPk, ctx.tenant.pk),
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
        tenantPk: ctx.tenant.pk,
      });
      if (!group)
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });

      await db.insert(groupAssignable).values(
        input.members.map((member) => ({
          groupPk: group.pk,
          groupablePk: member.pk,
          groupableVariant: member.variant,
        }))
      );
    }),
});
