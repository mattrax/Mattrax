import { describe, expect, it } from "vitest";
import { managementWebhookOpenApi } from "../index.js";

const httpMethods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

const document = managementWebhookOpenApi();

const operations = Object.values(document.paths).flatMap((pathItem) =>
  httpMethods.flatMap((method) => {
    const operation = pathItem[method];

    return operation ? [operation] : [];
  }),
);

const expectedOperationIds = [
  "ManagementWebhook.appleDeviceEvent",
  "ManagementWebhook.appleManagementCheckin",
  "ManagementWebhook.getAppleBootstrapToken",
  "ManagementWebhook.appleReturnToServiceConfiguration",
  "ManagementWebhook.getAppleDeclarationTokens",
  "ManagementWebhook.getAppleDeclarationItems",
  "ManagementWebhook.getAppleDeclaration",
  "ManagementWebhook.getAppleAsset",
  "ManagementWebhook.getAppleProfile",
  "ManagementWebhook.windowsDiscovery",
  "ManagementWebhook.getWindowsEnrollmentPolicy",
  "ManagementWebhook.windowsEnroll",
  "ManagementWebhook.windowsManagementCheckin",
  "ManagementWebhook.windowsDeviceEvent",
].sort();

describe("management webhook OpenAPI", () => {
  it("documents all 14 paths, each under /webhook/", () => {
    const paths = Object.keys(document.paths);

    expect(paths).toHaveLength(14);

    for (const path of paths) {
      expect(path.startsWith("/webhook/")).toBe(true);
      expect(path.startsWith("/api/")).toBe(false);
      expect(path.startsWith("/mdm")).toBe(false);
    }
  });

  it("annotates the API and the group tag", () => {
    expect(document.info.title).toBe("Mattrax Management Webhook");
    expect(document.info.version).toBe("1.0.0");
    expect(document.servers).toEqual([{ url: "/" }]);

    const tag = document.tags.find((candidate) => candidate.name === "Management Webhook");

    expect(tag?.description).toBeTruthy();

    for (const operation of operations) expect(operation.tags).toContain("Management Webhook");
  });

  it("documents both webhook security schemes", () => {
    const schemes = document.components.securitySchemes;

    expect(schemes["x-mattrax-timestamp"]).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-mattrax-timestamp",
    });
    expect(schemes["x-mattrax-signature"]).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-mattrax-signature",
    });
  });

  it("requires both headers on every operation", () => {
    expect(operations).toHaveLength(14);

    for (const operation of operations) {
      expect(operation.security).toHaveLength(1);
      expect(Object.keys(operation.security[0] ?? {})).toEqual([
        "x-mattrax-timestamp",
        "x-mattrax-signature",
      ]);
    }
  });

  it("uses prefixed operation ids", () => {
    expect(operations.map((operation) => operation.operationId).sort()).toEqual(
      expectedOperationIds,
    );
  });

  it("memoizes the generated document", () => {
    expect(managementWebhookOpenApi()).toBe(document);
  });

  it("declares both 200 and 204 for appleDeviceEvent", () => {
    const operation = operations.find(
      (candidate) => candidate.operationId === "ManagementWebhook.appleDeviceEvent",
    );

    expect(operation).toBeDefined();
    expect(Object.keys(operation!.responses).sort()).toEqual(["200", "204", "500"]);
  });
});
