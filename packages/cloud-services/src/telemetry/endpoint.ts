/**
 * `GET /api/metrics` exposure policy.
 *
 * Metrics describe the deployment, not a tenant, but the endpoint is off
 * unless an operator opts in. `token` mode requires `MATTRAX_METRICS_TOKEN`
 * and fails closed when it is missing, so a partial configuration cannot
 * accidentally publish the payload.
 */

import { timingSafeStringEqual } from "../devMailbox.js";

export type MetricsExposureMode = "off" | "public" | "token";

export type MetricsExposure = {
  readonly mode: MetricsExposureMode;
  readonly enabled: boolean;
  readonly token?: string;
};

export const resolveMetricsExposure = (input: {
  readonly mode?: string | undefined;
  readonly token?: string | undefined;
  readonly telemetryEnabled: boolean;
}): MetricsExposure => {
  if (!input.telemetryEnabled) return { mode: "off", enabled: false };

  const mode = input.mode?.trim().toLowerCase();
  const token = input.token?.trim();

  if (mode === "token")
    return token ? { mode: "token", enabled: true, token } : { mode: "off", enabled: false };

  if (mode === "public" || mode === "on" || mode === "true" || mode === "1")
    return { mode: "public", enabled: true };

  return { mode: "off", enabled: false };
};

/** `Authorization: Bearer <token>`, compared in constant time. */
export const metricsRequestAuthorised = (
  exposure: MetricsExposure,
  authorization: string | null | undefined,
): boolean => {
  if (exposure.mode === "public") return true;

  if (exposure.mode !== "token" || !exposure.token) return false;

  if (!authorization) return false;

  const [scheme, value, ...rest] = authorization.trim().split(/\s+/);

  if (rest.length > 0 || !value || scheme?.toLowerCase() !== "bearer") return false;

  return timingSafeStringEqual(value, exposure.token);
};
