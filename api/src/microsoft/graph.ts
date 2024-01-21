import { env } from "../env";
import { authenticatedFetch } from "./auth";

type ChangeType = "created" | "updated" | "deleted";

const subscriptionExpiration = 4230;

export const subscribe = (
  resource: string,
  changeType: ChangeType[],
  clientState: string
) =>
  authenticatedFetch<{
    id: string;
    //  More properties that aren't important
  }>("/subscriptions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      changeType: changeType.join(","),
      notificationUrl: `${env.VERCEL_URL}/api/webhook/ms`,
      lifecycleNotificationUrl: `${env.VERCEL_URL}/api/webhook/msLifecycle`,
      resource: resource,
      expirationDateTime: addMinutes(
        new Date(),
        subscriptionExpiration
      ).toISOString(),
      clientState,
    }),
  });

export const getSubscription = (id: string) =>
  authenticatedFetch<{
    id: string;
    //  More properties that aren't important
  }>(`/subscriptions/${id}`);

export const subscriptionRenew = (id: string) =>
  authenticatedFetch<{
    id: string;
    //  More properties that aren't important
  }>(`/subscriptions/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expirationDateTime: addMinutes(
        new Date(),
        subscriptionExpiration
      ).toISOString(),
    }),
  });

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60000);
}
