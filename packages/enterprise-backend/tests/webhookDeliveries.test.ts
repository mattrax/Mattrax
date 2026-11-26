import { describe, expect, it } from "vitest";
import {
  listWebhookDeliveries,
  loadWebhookDelivery,
  webhookDeliverySummaryColumns,
} from "../src/Webhook/webhookDeliveries.ts";
import { makeDb, runEffect } from "./helpers.js";

const now = new Date("2026-11-16T12:00:00.000Z");

type Selection = NonNullable<Parameters<ReturnType<typeof makeDb>["select"]>[0]>;

const deliveryRow = () => {
  let payloadReads = 0;
  const payload = {
    id: "evt-1",
    type: "device.enrolled",
    organizationId: "org-1",
    data: { targetId: "device-1" },
  };

  const row = {
    id: "delivery-1",
    endpointId: "webhook-1",
    organizationId: "org-1",
    event: "device.enrolled",
    eventId: "evt-1",
    get payload() {
      payloadReads += 1;
      return payload;
    },
    status: "succeeded" as const,
    attempt: 1,
    responseStatus: 200,
    error: null,
    createdAt: new Date("2026-11-16T10:00:00.000Z"),
  };

  return { row, payload, payloadReads: () => payloadReads };
};

describe("webhook delivery history projection", () => {
  it("selects and reads only summary columns while listing history", async () => {
    const db = makeDb();
    const fixture = deliveryRow();
    db.store.webhook_delivery.push(fixture.row);

    const selections: Array<Selection | undefined> = [];
    const select = db.select.bind(db);
    db.select = ((fields?: Selection) => {
      selections.push(fields);
      if (fields === undefined) return select();

      return select(fields);
    }) as typeof db.select;

    const page = await runEffect(
      listWebhookDeliveries({
        db,
        organizationId: "org-1",
        endpointId: "webhook-1",
        now,
      }),
    );

    expect(page.deliveries).toEqual([
      {
        id: "delivery-1",
        endpointId: "webhook-1",
        event: "device.enrolled",
        eventId: "evt-1",
        status: "succeeded",
        attempt: 1,
        responseStatus: 200,
        error: null,
        createdAt: "2026-11-16T10:00:00.000Z",
      },
    ]);
    expect(Object.keys(selections[0] ?? {}).sort()).toEqual(
      Object.keys(webhookDeliverySummaryColumns).sort(),
    );
    expect(selections[0]).not.toHaveProperty("payload");
    expect(fixture.payloadReads()).toBe(0);
  });

  it("keeps the full payload selection for delivery detail", async () => {
    const db = makeDb();
    const fixture = deliveryRow();
    db.store.webhook_delivery.push(fixture.row);

    const selections: Array<Selection | undefined> = [];
    const select = db.select.bind(db);
    db.select = ((fields?: Selection) => {
      selections.push(fields);
      if (fields === undefined) return select();

      return select(fields);
    }) as typeof db.select;

    const detail = await runEffect(
      loadWebhookDelivery({
        db,
        organizationId: "org-1",
        endpointId: "webhook-1",
        deliveryId: "delivery-1",
      }),
    );

    expect(selections[0]).toBeUndefined();
    expect(detail.payload).toEqual(fixture.payload);
    expect(fixture.payloadReads()).toBeGreaterThan(0);
  });
});
