import path from "node:path";
import { eq } from "drizzle-orm";
import { exportQueries, defineOperation } from "@mattrax/drizzle-to-rs";
import { db, certificates, devices } from ".";
import dotenv from "dotenv";

dotenv.config({
  path: "../../../../.env",
});

exportQueries(
  [
    defineOperation({
      name: "get_certificate",
      args: {
        key: "String",
      },
      query: (args) =>
        db
          .select({
            certificate: certificates.certificate,
          })
          .from(certificates)
          .where(eq(certificates.key, args.key)),
    }),
    defineOperation({
      name: "store_certificate",
      args: {
        key: "String",
        certificate: "Vec<u8>",
        last_modified: "NaiveDateTime",
      },
      query: (args) =>
        db
          .insert(certificates)
          .values({
            key: args.key,
            certificate: args.certificate,
            lastModified: args.last_modified, // TODO: A system for automatic `new Date()`
          })
          .onDuplicateKeyUpdate({
            set: {
              certificate: args.certificate,
              lastModified: args.last_modified,
            },
          }),
    }),
    defineOperation({
      name: "create_device",
      args: {
        id: "String",
        name: "String",
        operating_system: "String",
        serial_number: "String",
        tenant_pk: "i32",
      },
      query: (args) =>
        db.insert(devices).values([
          {
            id: args.id,
            name: args.name,
            operatingSystem: args.operating_system,
            serialNumber: args.serial_number,
            tenantPk: args.tenant_pk,
          },
        ]),
    }),
  ],
  path.join(__dirname, "../../../../apps/mattrax/src/db.rs")
);
