import { getDevice, getDevices, syncDevice } from "../microsoft";
import { newAuthedApp } from "../utils";

export const app = newAuthedApp()
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
