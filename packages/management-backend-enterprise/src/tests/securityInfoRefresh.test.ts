import { describe, expect, it } from "vitest";
import {
  SECURITY_INFO_MAX_AGE_DAYS,
  SECURITY_INFO_REQUEST_INTERVAL_HOURS,
  securityInfoRefreshDue,
} from "../securityInfoRefresh.js";

const now = new Date("2026-05-01T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);

describe("securityInfoRefreshDue", () => {
  it("requests a report when no FileVault key is escrowed", () => {
    expect(
      securityInfoRefreshDue(
        { hasRecoveryKey: false, securityInfoUpdatedAt: null, fileVaultEnabled: true },
        now,
      ),
    ).toBe(true);
  });

  it("requests a report when the key exists but was never confirmed", () => {
    expect(securityInfoRefreshDue({ hasRecoveryKey: true, securityInfoUpdatedAt: null }, now)).toBe(
      true,
    );
  });

  it("does nothing while an answer is fresh", () => {
    expect(
      securityInfoRefreshDue(
        {
          hasRecoveryKey: true,
          securityInfoUpdatedAt: daysAgo(2),
          securityInfoRequestedAt: hoursAgo(30),
        },
        now,
      ),
    ).toBe(false);
  });

  it("re-requests once the answer is stale", () => {
    expect(
      securityInfoRefreshDue(
        {
          hasRecoveryKey: true,
          securityInfoUpdatedAt: daysAgo(SECURITY_INFO_MAX_AGE_DAYS + 1),
          securityInfoRequestedAt: daysAgo(SECURITY_INFO_MAX_AGE_DAYS + 1),
        },
        now,
      ),
    ).toBe(true);
  });

  it("rate-limits a device that never answers", () => {
    expect(
      securityInfoRefreshDue(
        {
          hasRecoveryKey: false,
          securityInfoUpdatedAt: null,
          securityInfoRequestedAt: hoursAgo(SECURITY_INFO_REQUEST_INTERVAL_HOURS - 1),
        },
        now,
      ),
    ).toBe(false);
  });

  it("allows a new request after the interval", () => {
    expect(
      securityInfoRefreshDue(
        {
          hasRecoveryKey: false,
          securityInfoUpdatedAt: null,
          securityInfoRequestedAt: hoursAgo(SECURITY_INFO_REQUEST_INTERVAL_HOURS + 1),
        },
        now,
      ),
    ).toBe(true);
  });

  it("honours explicit windows for tests and tenants", () => {
    expect(
      securityInfoRefreshDue({ hasRecoveryKey: true, securityInfoUpdatedAt: daysAgo(10) }, now, {
        maxAgeDays: 5,
        requestIntervalHours: 0,
      }),
    ).toBe(true);
  });
});
