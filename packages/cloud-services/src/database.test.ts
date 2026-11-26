import { describe, expect, it } from "vitest";
import {
  databaseConfigFromFields,
  databaseConfigFromUrl,
  mysqlClientOptions,
  mysqlConnectionOptions,
} from "./database.js";

const url = (query = "") => `mysql://user:p%40ss@database.example.com:3307/mattrax${query}`;

describe("shared database configuration", () => {
  it.each([
    ["", false],
    ["?ssl-mode=DISABLED", false],
    ["?sslmode=disabled", false],
    ["?ssl=false", false],
    ["?ssl-mode=REQUIRED", { rejectUnauthorized: false }],
    ["?sslmode=required", { rejectUnauthorized: false }],
    ["?ssl=true", { rejectUnauthorized: false }],
    ["?ssl-mode=VERIFY_CA", { rejectUnauthorized: true }],
    ["?sslmode=verify_ca", { rejectUnauthorized: true }],
    ["?ssl-mode=VERIFY_IDENTITY", { rejectUnauthorized: true }],
    ["?sslmode=verify_identity", { rejectUnauthorized: true }],
  ])("maps %s to the same TLS policy for pools and migrations", (query, ssl) => {
    const config = databaseConfigFromUrl(url(query));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl,
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual(ssl === false ? undefined : ssl);
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual(ssl === false ? undefined : ssl);
  });

  it("defaults the port and preserves explicit disabled TLS", () => {
    const config = databaseConfigFromUrl("mysql://user:pass@database.example.com/mattrax");

    expect(config.port).toBe(3306);
    expect(mysqlConnectionOptions(config).ssl).toBeUndefined();
  });

  it("decodes discrete fields with the same validation", () => {
    expect(
      databaseConfigFromFields({
        host: " database.example.com ",
        user: "user",
        password: "pass",
        database: "mattrax",
      }),
    ).toMatchObject({ host: "database.example.com", port: 3306, ssl: false });
  });

  it.each([
    "not a URL",
    "https://user:pass@database.example.com/mattrax",
    "mysql://user:pass@/mattrax",
    "mysql://user:pass@database.example.com/",
    "mysql://user:pass@database.example.com/one/two",
    "mysql://user:pass@database.example.com:0/mattrax",
    "mysql://user:pass@database.example.com:65536/mattrax",
    "mysql://user:pass@database.example.com:nope/mattrax",
    "mysql://user:p%ZZ@database.example.com/mattrax",
    url("?ssl-mode=PREFERRED"),
    url("?ssl-mode=REQUIRED&sslmode=DISABLED"),
    url("?ssl=maybe"),
    url("?ssl-mode="),
    url("?ssl-mode=VERIFY_IDENTITY&ssl=false"),
    url("?ssl-mode=DISABLED&ssl=true"),
  ])("rejects malformed configuration before connecting: %s", (value) => {
    expect(() => databaseConfigFromUrl(value)).toThrow();
  });

  it("rejects invalid discrete ports", () => {
    expect(() =>
      databaseConfigFromFields({
        host: "database.example.com",
        port: "1.5",
        user: "user",
        password: "pass",
        database: "mattrax",
      }),
    ).toThrow();
  });
});
