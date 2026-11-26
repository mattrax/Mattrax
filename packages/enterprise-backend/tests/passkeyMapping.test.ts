import { describe, expect, it } from "vitest";
import { passkeyRegistrationMapping } from "@mattrax/enterprise-core/schema";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const dialect = new MySqlDialect();
const registration = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  grant: "mailbox-proof",
};

const expectLiveGrant = (sql: string, params: unknown[]) => {
  expect(sql).toContain("registration_verification");
  expect(sql).toContain("registration_verification`.`email` =");
  expect(sql).toContain("registration_verification`.`grant` =");
  expect(sql).toContain("registration_verification`.`verified_at` is not null");
  expect(sql).toContain("registration_verification`.`verified_at` <=");
  expect(sql).toContain("registration_verification`.`expires_at` >");
  expect(params).toContain(registration.email);
  expect(params).toContain(registration.grant);
};

/**
 * Password managers label passkey entries with the WebAuthn username, and
 * Hyperdrive can return MySQL BIGINT columns as strings. Both boundaries are
 * easy to regress because the passkey library treats them as opaque values.
 */
describe("passkey registration mapping", () => {
  it("uses the email as the WebAuthn username", () => {
    expect(
      passkeyRegistrationMapping.registration.describe({
        name: "Ada Lovelace",
        email: "ada@example.com",
      }),
    ).toEqual({ name: "ada@example.com", displayName: "Ada Lovelace" });
  });

  it("coerces MySQL BIGINT instants to numbers", () => {
    expect(passkeyRegistrationMapping.clock.decodeInstant("1795384204612")).toBe(1795384204612);
  });

  it("requires a live matching grant and an unused email at eligibility", () => {
    const query = dialect.sqlToQuery(
      passkeyRegistrationMapping.registration.eligible(registration),
    );

    expect(query.sql).toContain("not exists(select 1 from `account`");
    expectLiveGrant(query.sql, query.params);
  });

  it("derives email verification from the same live grant during subject insertion", () => {
    const subject = passkeyRegistrationMapping.registration.subject({
      registration,
      marker: "revision",
    });
    const query = dialect.sqlToQuery(subject.values.emailVerified);

    expectLiveGrant(query.sql, query.params);
  });

  it("rechecks the verified subject and live grant at final persistence", () => {
    const query = dialect.sqlToQuery(
      passkeyRegistrationMapping.registration.finalEligibility({
        registration,
        subjectId: "subject-1",
      }),
    );

    expect(query.sql).toContain("account`.`email_verified` = true");
    expect(query.sql).toContain("account`.`disabled` = false");
    expectLiveGrant(query.sql, query.params);
  });
});
