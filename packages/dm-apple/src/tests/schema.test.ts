import { describe, it, expect } from "vitest";
import { Effect, Schema } from "effect";
import {
  AuthenticatePlist,
  TokenUpdatePlist,
  CheckOutPlist,
  CommandResultPlist,
  DDMStatusReport,
} from "../schema.js";

describe("schema", () => {
  describe("AuthenticatePlist", () => {
    it("decodes a valid Authenticate payload", async () => {
      const data = {
        MessageType: "Authenticate",
        Topic: "com.apple.mgmt.External",
        UDID: "test-udid",
        SerialNumber: "ABC123",
        OSVersion: "14.0",
        Model: "MacBookPro18,1",
      };
      const result = await Schema.decodeUnknownEffect(AuthenticatePlist)(data).pipe(Effect.runPromise);
      expect(result.MessageType).toBe("Authenticate");
      expect(result.UDID).toBe("test-udid");
      expect(result.SerialNumber).toBe("ABC123");
    });

    it("rejects missing required fields", async () => {
      const data = { MessageType: "Authenticate", UDID: "test" };
      const result = await Schema.decodeUnknownEffect(AuthenticatePlist)(data).pipe(Effect.runPromiseExit);
      expect(result._tag).toBe("Failure");
    });

    it("allows optional fields to be absent", async () => {
      const data = {
        MessageType: "Authenticate",
        Topic: "com.apple.mgmt.External",
        UDID: "test-udid",
      };
      const result = await Schema.decodeUnknownEffect(AuthenticatePlist)(data).pipe(Effect.runPromise);
      expect(result.SerialNumber).toBeUndefined();
      expect(result.OSVersion).toBeUndefined();
    });
  });

  describe("TokenUpdatePlist", () => {
    it("decodes a valid device-scoped TokenUpdate", async () => {
      const data = {
        MessageType: "TokenUpdate",
        Topic: "com.apple.mgmt.External",
        UDID: "test-udid",
        PushMagic: "magic-123",
        Token: "dGVzdA==",
      };
      const result = await Schema.decodeUnknownEffect(TokenUpdatePlist)(data).pipe(Effect.runPromise);
      expect(result.MessageType).toBe("TokenUpdate");
      expect(result.UserID).toBeUndefined();
    });

    it("decodes a user-scoped TokenUpdate", async () => {
      const data = {
        MessageType: "TokenUpdate",
        Topic: "com.apple.mgmt.External",
        UDID: "test-udid",
        PushMagic: "magic-123",
        Token: "dGVzdA==",
        UserID: "user-123",
      };
      const result = await Schema.decodeUnknownEffect(TokenUpdatePlist)(data).pipe(Effect.runPromise);
      expect(result.UserID).toBe("user-123");
    });
  });

  describe("CheckOutPlist", () => {
    it("decodes a valid CheckOut", async () => {
      const data = {
        MessageType: "CheckOut",
        Topic: "com.apple.mgmt.External",
        UDID: "test-udid",
      };
      const result = await Schema.decodeUnknownEffect(CheckOutPlist)(data).pipe(Effect.runPromise);
      expect(result.MessageType).toBe("CheckOut");
    });
  });

  describe("CommandResultPlist", () => {
    it("decodes a successful result", async () => {
      const data = {
        UDID: "test-udid",
        Status: "Acknowledged",
        CommandUUID: "cmd-001",
      };
      const result = await Schema.decodeUnknownEffect(CommandResultPlist)(data).pipe(Effect.runPromise);
      expect(result.Status).toBe("Acknowledged");
      expect(result.Command).toBeUndefined();
    });

    it("decodes a result with ErrorChain", async () => {
      const data = {
        UDID: "test-udid",
        Status: "Error",
        CommandUUID: "cmd-002",
        ErrorChain: [
          { ErrorCode: 89, ErrorDomain: "MDMClientError" },
        ],
      };
      const result = await Schema.decodeUnknownEffect(CommandResultPlist)(data).pipe(Effect.runPromise);
      expect(result.ErrorChain).toHaveLength(1);
      expect(result.ErrorChain![0].ErrorCode).toBe(89);
    });

    it("decodes a result with QueryResponses", async () => {
      const data = {
        UDID: "test-udid",
        Status: "Acknowledged",
        CommandUUID: "cmd-003",
        QueryResponses: { DeviceName: "TestMac" },
      };
      const result = await Schema.decodeUnknownEffect(CommandResultPlist)(data).pipe(Effect.runPromise);
      expect(result.QueryResponses).toEqual({ DeviceName: "TestMac" });
    });
  });

  describe("DDMStatusReport", () => {
    it("decodes a minimal status report", async () => {
      const data = { StatusItems: {} };
      const result = await Schema.decodeUnknownEffect(DDMStatusReport)(data).pipe(Effect.runPromise);
      expect(result.StatusItems).toEqual({});
      expect(result.Errors).toBeUndefined();
    });

    it("decodes a report with errors", async () => {
      const data = {
        StatusItems: {},
        Errors: [
          {
            Identifier: "decl-1",
            ServerToken: "token-1",
            Active: true,
            Valid: "invalid",
            Reasons: [{ Description: "Something went wrong" }],
          },
        ],
      };
      const result = await Schema.decodeUnknownEffect(DDMStatusReport)(data).pipe(Effect.runPromise);
      expect(result.Errors).toHaveLength(1);
      expect(result.Errors![0].Identifier).toBe("decl-1");
      expect(result.Errors![0].Reasons![0].Description).toBe("Something went wrong");
    });
  });
});
