import { describe, expect, it } from "vitest";
import {
  databaseConfigFromFields,
  databaseConfigFromUrl,
  mysqlClientOptions,
  mysqlConnectionOptions,
} from "./database.js";

const url = (query = "") => `mysql://user:p%40ss@database.example.com:3307/mattrax${query}`;

describe("shared database configuration", () => {
  it("maps no TLS parameters", () => {
    const config = databaseConfigFromUrl(url(""));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: false,
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual(undefined);
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual(undefined);
  });

  it("maps ssl-mode=DISABLED", () => {
    const config = databaseConfigFromUrl(url("?ssl-mode=DISABLED"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: false,
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual(undefined);
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual(undefined);
  });

  it("maps sslmode=disabled", () => {
    const config = databaseConfigFromUrl(url("?sslmode=disabled"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: false,
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual(undefined);
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual(undefined);
  });

  it("maps ssl=false", () => {
    const config = databaseConfigFromUrl(url("?ssl=false"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: false,
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual(undefined);
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual(undefined);
  });

  it("maps ssl-mode=REQUIRED", () => {
    const config = databaseConfigFromUrl(url("?ssl-mode=REQUIRED"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: { rejectUnauthorized: false },
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual({ rejectUnauthorized: false });
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("maps sslmode=required", () => {
    const config = databaseConfigFromUrl(url("?sslmode=required"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: { rejectUnauthorized: false },
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual({ rejectUnauthorized: false });
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("maps ssl=true", () => {
    const config = databaseConfigFromUrl(url("?ssl=true"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: { rejectUnauthorized: false },
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual({ rejectUnauthorized: false });
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("maps ssl-mode=VERIFY_CA", () => {
    const config = databaseConfigFromUrl(url("?ssl-mode=VERIFY_CA"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: { rejectUnauthorized: true },
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual({ rejectUnauthorized: true });
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("maps sslmode=verify_ca", () => {
    const config = databaseConfigFromUrl(url("?sslmode=verify_ca"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: { rejectUnauthorized: true },
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual({ rejectUnauthorized: true });
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("maps ssl-mode=VERIFY_IDENTITY", () => {
    const config = databaseConfigFromUrl(url("?ssl-mode=VERIFY_IDENTITY"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: { rejectUnauthorized: true },
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual({ rejectUnauthorized: true });
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("maps sslmode=verify_identity", () => {
    const config = databaseConfigFromUrl(url("?sslmode=verify_identity"));

    expect(config).toEqual({
      host: "database.example.com",
      port: 3307,
      user: "user",
      password: "p@ss",
      database: "mattrax",
      ssl: { rejectUnauthorized: true },
    });
    expect(mysqlConnectionOptions(config).ssl).toEqual({ rejectUnauthorized: true });
    expect(mysqlClientOptions(config).poolConfig.ssl).toEqual({ rejectUnauthorized: true });
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

  it("rejects a string that is not a URL", () => {
    expect(() => databaseConfigFromUrl("not a URL")).toThrow();
  });

  it("rejects an https URL", () => {
    expect(() => databaseConfigFromUrl("https://user:pass@database.example.com/mattrax")).toThrow();
  });

  it("rejects a URL without a host", () => {
    expect(() => databaseConfigFromUrl("mysql://user:pass@/mattrax")).toThrow();
  });

  it("rejects a URL without a database", () => {
    expect(() => databaseConfigFromUrl("mysql://user:pass@database.example.com/")).toThrow();
  });

  it("rejects a URL with a path segment in the database name", () => {
    expect(() => databaseConfigFromUrl("mysql://user:pass@database.example.com/one/two")).toThrow();
  });

  it("rejects a URL with port zero", () => {
    expect(() =>
      databaseConfigFromUrl("mysql://user:pass@database.example.com:0/mattrax"),
    ).toThrow();
  });

  it("rejects a URL with a port above 65535", () => {
    expect(() =>
      databaseConfigFromUrl("mysql://user:pass@database.example.com:65536/mattrax"),
    ).toThrow();
  });

  it("rejects a URL with a non-numeric port", () => {
    expect(() =>
      databaseConfigFromUrl("mysql://user:pass@database.example.com:nope/mattrax"),
    ).toThrow();
  });

  it("rejects a URL with an invalid escape in the password", () => {
    expect(() => databaseConfigFromUrl("mysql://user:p%ZZ@database.example.com/mattrax")).toThrow();
  });

  it("rejects an unsupported ssl-mode", () => {
    expect(() => databaseConfigFromUrl(url("?ssl-mode=PREFERRED"))).toThrow();
  });

  it("rejects conflicting ssl-mode and sslmode", () => {
    expect(() => databaseConfigFromUrl(url("?ssl-mode=REQUIRED&sslmode=DISABLED"))).toThrow();
  });

  it("rejects an unsupported ssl value", () => {
    expect(() => databaseConfigFromUrl(url("?ssl=maybe"))).toThrow();
  });

  it("rejects an empty ssl-mode", () => {
    expect(() => databaseConfigFromUrl(url("?ssl-mode="))).toThrow();
  });

  it("rejects conflicting VERIFY_IDENTITY and ssl=false", () => {
    expect(() => databaseConfigFromUrl(url("?ssl-mode=VERIFY_IDENTITY&ssl=false"))).toThrow();
  });

  it("rejects conflicting DISABLED and ssl=true", () => {
    expect(() => databaseConfigFromUrl(url("?ssl-mode=DISABLED&ssl=true"))).toThrow();
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
