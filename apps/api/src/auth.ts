import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { stripe } from "@better-auth/stripe";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { createDb } from "./db/index.js";
import * as schema from "./db/schema.js";
import { env } from "cloudflare:workers";

export const createAuth = (): any => {
  const db = createDb(env.DB);
  const stripeClient = new Stripe((env as any).STRIPE_SECRET_KEY, {
    apiVersion: "2026-04-22.dahlia",
  });

  return betterAuth({
    database: drizzleAdapter(createDb(env.DB), {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
        subscription: schema.subscription,
      },
    }),
    secret: env.AUTH_SECRET,
    baseURL: env.ORIGIN,
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        console.log("RESET EMAIL", user, url);
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailVerification: async (params: {
          user: { email: string };
          newEmail: string;
          url: string;
        }) => {
          const { user, newEmail, url } = params;
          console.log("CHANGE EMAIL VERIFICATION", user.email, "->", newEmail, url);
        },
      },
    },
    plugins: [
      organization({
        disableOrganizationDeletion: true,
        organizationHooks: {
          afterCreateOrganization: async ({ organization }) => {
            const now = new Date();
            await db.insert(schema.enterpriseEnrollment).values({
              id: organization.id,
              organizationId: organization.id,
              createdAt: now,
              updatedAt: now,
            }).onConflictDoNothing();
          },
        },
      }),
      stripe({
        stripeClient,
        stripeWebhookSecret: (env as any).STRIPE_WEBHOOK_SECRET,
        createCustomerOnSignUp: false,
        organization: { enabled: true },
        subscription: {
          enabled: true,
          plans: [
            {
              name: "device-monthly",
              priceId: (env as any).STRIPE_DEVICE_MONTHLY_PRICE_ID,
              limits: {},
            },
          ],
          authorizeReference: async ({ user, referenceId }) => {
            if (!referenceId) return false;
            const membership = await db.query.member.findFirst({
              where: and(eq(schema.member.userId, user.id), eq(schema.member.organizationId, referenceId)),
            });
            return membership !== undefined;
          },
        },
      }),
    ],
  });
};
