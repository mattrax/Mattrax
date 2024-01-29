import { z } from "zod";
import {
  createEnrollmentProfile,
  exportEnrollmentProfile,
  syncDevice,
} from "../microsoft";
import { newUnauthenticatedApp, newApp } from "../utils";
import { zValidator } from "@hono/zod-validator";
import { db, devices } from "../db";

export const authenticatedApp = newApp()
  .get("/", async (c) => {
    // TODO: Is the user authorised to the current tenant???

    // TODO: Filter to only devices in current tenant
    // TODO: .where(eq(devices.tenantId, todo))
    return c.json(
      await db
        .select({
          id: devices.id,
          name: devices.name,
        })
        .from(devices)
    );
  })
  .get("/:deviceId", async (c) => {
    const deviceId = c.req.param("deviceId");
    // TODO: Check user is authorised to access tenant which owns the device

    // TODO: Filter to only devices in current tenant
    // TODO: .where(eq(devices.tenantId, todo))
    return c.json(
      (
        await db
          .select({
            name: devices.name,
          })
          .from(devices)
      )?.[0]
    );
  })
  .post("/:deviceId/sync", async (c) => {
    const deviceId = c.req.param("deviceId");
    // TODO: Check user is authorised to access tenant which owns the device

    // TODO: Filter to only devices in current tenant
    // TODO: .where(eq(devices.tenantId, todo))
    const device = (
      await db
        .select({
          intuneId: devices.intuneId,
        })
        .from(devices)
    )?.[0];
    if (!device) throw new Error("Device not found"); // TODO: Properly handle this error on frontend

    await syncDevice(device.intuneId);
    return c.json({});
  });

type EnrollmentProfileDescription = {
  data: string;
  createdAt: number;
};

// TODO: Remove unauthenticated app
export const app = newUnauthenticatedApp()
  .post(
    "/enroll/ios",
    zValidator(
      "json",
      z.object({
        // TODO: For now data is meant to replicate what auth would be
        data: z.string(),
      })
    ),
    async (c) => {
      const input = c.req.valid("json");

      // TODO: Use existing enrollment profile if it exists
      const enrollmentProfile = await createEnrollmentProfile(
        `enrollment-${Date.now()}`,
        JSON.stringify({
          data: input.data,
          createdAt: Date.now(),
        } satisfies EnrollmentProfileDescription)
      );

      const result = await exportEnrollmentProfile(enrollmentProfile!.id); // TODO: Why can `enrollmentProfile` be `undefined`???

      return c.json({
        value: result!.value,
      });
    }
  )
  // TODO: macOS enrollment
  // TODO: Windows enrollment
  .route("/", authenticatedApp);
