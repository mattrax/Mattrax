import { z } from "zod";
import {
  createEnrollmentProfile,
  exportEnrollmentProfile,
  getDevice,
  getDevices,
  getFrankAccessToken,
  syncDevice,
} from "../microsoft";
import { newApp, newAuthedApp } from "../utils";
import { zValidator } from "@hono/zod-validator";

export const authenticatedApp = newAuthedApp()
  .get("/", async (c) => {
    // TODO: Is the user authorised to the current tenant???
    // TODO: Only return devices in the current tenant
    // TODO: Serve from DB

    const devices = await getDevices();
    // TODO: Filter to only devices in current tenant

    return c.json(
      // @ts-expect-error // TODO: Fix types
      devices.value.map((d) => ({
        id: d.id,
        // @ts-expect-error // TODO: Fix types
        name: d.deviceName,
      }))
    );
  })
  .get("/:deviceId", async (c) => {
    const deviceId = c.req.param("deviceId");
    // TODO: Check user is authorised to access tenant which owns the device

    // TODO: Serve from DB instead
    const device = await getDevice(deviceId);

    return c.json({
      // @ts-expect-error // TODO: Fix incorrect types
      name: device.deviceName,
    });
  })
  .post("/:deviceId/sync", async (c) => {
    const deviceId = c.req.param("deviceId");
    // TODO: Check user is authorised to access tenant which owns the device

    await syncDevice(deviceId);
    return c.json({});
  });

type EnrollmentProfileDescription = {
  data: string;
  createdAt: number;
};

// TODO: Remove unauthenticated app
export const app = newApp()
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
        value: result?.value,
      });
    }
  )
  // TODO: macOS enrollment
  // TODO: Windows enrollment
  .route("/", authenticatedApp);
