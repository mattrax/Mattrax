/**
 * Scheduled triggers, shared by the Worker deployment config and the handler
 * that dispatches them. Keep the daily run off-peak in UTC; the hourly trigger
 * sits at minute 47 so the daily maintenance window has already closed.
 */
export const DAILY_CRON = "17 3 * * *";

/** Outbox retries, Entra directory sweeps and the origin certificate probe. */
export const HOURLY_CRON = "47 * * * *";
