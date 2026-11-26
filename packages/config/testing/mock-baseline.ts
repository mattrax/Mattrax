/**
 * Existing vi.mock / vi.spyOn / vi.fn call sites, ratcheted by the
 * `testing/no-vitest-mocking` lint rule. Shared with the Vitest config so the
 * files that replace imports automatically keep their own module graph.
 */
export const vitestMockBaseline = {
  "apps/web/src/components/dashboard/preview.test.ts": 4,
  "apps/web/src/components/dashboard/widget.test.ts": 13,
  "apps/web/src/components/mdm/persisted-state.test.ts": 2,
  "apps/web/src/components/mdm/table.component.test.tsx": 17,
  "apps/web/src/components/onboarding-checklist.test.tsx": 14,
  "apps/web/src/components/settings/section-tabs-nav.test.ts": 1,
  "apps/web/src/lib/analytics-queue.test.ts": 8,
  "apps/web/src/lib/auth-http.test.ts": 4,
  "apps/web/src/lib/auth-passkey.test.ts": 2,
  "apps/web/src/lib/cross-tab-sync.test.ts": 4,
  "apps/web/src/lib/enterprise.test.ts": 6,
  "apps/web/src/lib/entity-summary.test.ts": 2,
  "apps/web/src/lib/hash-scroll.test.ts": 4,
  "apps/web/src/lib/me-cache.test.ts": 4,
  "apps/web/src/lib/me-preload.test.ts": 2,
  "apps/web/src/lib/passkey-sign-in.test.ts": 2,
  "apps/web/src/lib/posthog.test.ts": 7,
  "apps/web/src/lib/session-presence.test.ts": 6,
  "apps/web/src/lib/stale-write.test.ts": 4,
  "apps/web/src/lib/theme.test.ts": 2,
  "apps/web/src/routes/(dashboard)/t/[tenantId]/devices/device-async.test.tsx": 55,
  "apps/web/src/routes/login.test.tsx": 16,
  "apps/web/src/routes/register.test.tsx": 15,
  "packages/enterprise-api/tests/appleByod.test.ts": 3,
  "packages/enterprise-api/tests/appleByodRateLimit.test.ts": 3,
  "packages/enterprise-api/tests/invitations.test.ts": 1,
  "packages/enterprise-api/tests/scimTransactions.test.ts": 4,
  "packages/enterprise-backend/tests/appleBusinessManager.test.ts": 1,
  "packages/enterprise-backend/tests/credentialHealth.test.ts": 1,
  "packages/enterprise-backend/tests/storageValidationCache.test.ts": 1,
  "packages/enterprise-tokens/src/tokens.test.ts": 1,
  "packages/plist/src/tests/plist.test.ts": 1,
} satisfies Record<string, number>;
