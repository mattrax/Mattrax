import path from "node:path";
import { eq } from "drizzle-orm";
import { exportQueries, defineQuery } from "@mattrax/drizzle-to-rs";
import { db, domains } from ".";
import dotenv from "dotenv";

dotenv.config({
  path: "../../../../.env",
});

exportQueries(
  [
    defineQuery({
      name: "get_domain",
      args: {
        domain: "String",
      },
      query: (args) =>
        db.select().from(domains).where(eq(domains.domain, args.domain)),
    }),
    defineQuery({
      name: "get_domains",
      query: () =>
        db
          .select({
            domain: domains.domain,
          })
          .from(domains),
    }),
  ],
  path.join(__dirname, "../../../../apps/mattrax/src/db.rs")
);
