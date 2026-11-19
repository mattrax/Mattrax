import { describe, it, expect } from "vitest";
import { Effect, Schema } from "effect";
import {
  AuthenticatePlist,
  TokenUpdatePlist,
  CheckOutPlist,
  CommandResultPlist,
  DDMStatusReport,
  resolveCheckinChannel,
  SHARED_IPAD_USER_ID,
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

      const result = await Schema.decodeUnknownEffect(AuthenticatePlist)(data).pipe(
        Effect.runPromise,
      );

      expect(result.MessageType).toBe("Authenticate");
      expect(result.UDID).toBe("test-udid");
      expect(result.SerialNumber).toBe("ABC123");
    });

    it("rejects missing required fields", async () => {
      const data = { MessageType: "Authenticate", UDID: "test" };

      const result = await Schema.decodeUnknownEffect(AuthenticatePlist)(data).pipe(
        Effect.runPromiseExit,
      );

      expect(result._tag).toBe("Failure");
    });

    it("allows optional fields to be absent", async () => {
      const data = {
        MessageType: "Authenticate",
        Topic: "com.apple.mgmt.External",
        UDID: "test-udid",
      };

      const result = await Schema.decodeUnknownEffect(AuthenticatePlist)(data).pipe(
        Effect.runPromise,
      );

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

      const result = await Schema.decodeUnknownEffect(TokenUpdatePlist)(data).pipe(
        Effect.runPromise,
      );

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

      const result = await Schema.decodeUnknownEffect(TokenUpdatePlist)(data).pipe(
        Effect.runPromise,
      );

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

      const result = await Schema.decodeUnknownEffect(CommandResultPlist)(data).pipe(
        Effect.runPromise,
      );

      expect(result.Status).toBe("Acknowledged");
      expect(result.Command).toBeUndefined();
    });

    it("decodes a result with ErrorChain", async () => {
      const data = {
        UDID: "test-udid",
        Status: "Error",
        CommandUUID: "cmd-002",
        ErrorChain: [{ ErrorCode: 89, ErrorDomain: "MDMClientError" }],
      };

      const result = await Schema.decodeUnknownEffect(CommandResultPlist)(data).pipe(
        Effect.runPromise,
      );

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

      const result = await Schema.decodeUnknownEffect(CommandResultPlist)(data).pipe(
        Effect.runPromise,
      );

      expect(result.QueryResponses).toEqual({ DeviceName: "TestMac" });
    });
  });

  describe("resolveCheckinChannel", () => {
    it("prefers UDID and reports the device channel without a user", () => {
      expect(resolveCheckinChannel({ UDID: "udid-1", EnrollmentID: "enrollment-1" })).toEqual({
        kind: "device",
        deviceIdentifier: "udid-1",
        enrollmentId: "enrollment-1",
      });
    });

    it("uses EnrollmentID for an Apple User Enrollment device", () => {
      expect(resolveCheckinChannel({ EnrollmentID: "enrollment-1" })).toEqual({
        kind: "device",
        deviceIdentifier: "enrollment-1",
        enrollmentId: "enrollment-1",
      });
    });

    it("marks a macOS/Shared iPad user channel as user-channel", () => {
      expect(
        resolveCheckinChannel({ UDID: "udid-1", UserID: "user-1", UserShortName: "oscar" }),
      ).toMatchObject({
        kind: "user",
        deviceIdentifier: "udid-1",
        userId: "user-1",
        source: "user-channel",
        userShortName: "oscar",
      });
    });

    it("keys a Shared iPad channel by its Managed Apple Account", () => {
      // Shared iPad sends the sentinel UserID for every login, so the token
      // would otherwise overwrite one shared row instead of one per person.
      expect(
        resolveCheckinChannel({
          UDID: "udid-1",
          UserID: SHARED_IPAD_USER_ID,
          UserShortName: "student@example.test",
          UserLongName: "Student",
        }),
      ).toMatchObject({
        kind: "user",
        deviceIdentifier: "udid-1",
        userId: "student@example.test",
        source: "user-channel",
        userShortName: "student@example.test",
      });
    });

    it("marks an EnrollmentUserID channel as user-enrollment", () => {
      expect(
        resolveCheckinChannel({ EnrollmentID: "enrollment-1", EnrollmentUserID: "user-1" }),
      ).toMatchObject({
        kind: "user",
        deviceIdentifier: "enrollment-1",
        userId: "user-1",
        source: "user-enrollment",
      });
    });

    it("returns null when Apple sent no device identifier", () => {
      expect(resolveCheckinChannel({})).toBeNull();
      // A user id alone cannot identify the device.
      expect(resolveCheckinChannel({ UserID: "user-1" })).toBeNull();
    });
  });

  describe("DDMStatusReport", () => {
    it("decodes a minimal status report", async () => {
      const data = { StatusItems: {} };

      const result = await Schema.decodeUnknownEffect(DDMStatusReport)(data).pipe(
        Effect.runPromise,
      );

      expect(result.StatusItems).toEqual({});
      expect(result.Errors).toBeUndefined();
    });

    it("decodes a report with errors", async () => {
      const data = {
        StatusItems: {},
        Errors: [
          {
            StatusItem: "management.declarations",
            Reasons: [
              { Code: "Error", Description: "Something went wrong", Details: { id: "decl-1" } },
            ],
          },
        ],
      };

      const result = await Schema.decodeUnknownEffect(DDMStatusReport)(data).pipe(
        Effect.runPromise,
      );

      expect(result.Errors).toHaveLength(1);
      expect(result.Errors![0].StatusItem).toBe("management.declarations");
      expect(result.Errors![0].Reasons![0]?.Description).toBe("Something went wrong");
    });
  });
});
