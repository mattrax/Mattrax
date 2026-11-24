import {
  BeginRegistrationVerificationResponse,
  CompleteRegistrationVerificationResponse,
} from "@mattrax/enterprise-domain/client";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeAuthEnvelope } from "./auth";
import { PreloadedSession } from "./session-store";

const session = {
  sessionId: "session-1",
  subjectId: "account-1",
  claims: { name: "Ada", email: "ada@example.com", emailVerified: true },
};
const registration = { status: "ok", emailSent: true } as const;
const directSuccess = { directSuccess: true } as const;

describe("auth envelope decoding", () => {
  it("publishes only a schema-valid session payload", () => {
    expect(
      decodeAuthEnvelope(200, { _tag: "Success", value: session }, Schema.NullOr(PreloadedSession)),
    ).toEqual({ value: session, private: undefined });
  });

  it("accepts the Enterprise API's direct registration-verification payload", () => {
    expect(
      decodeAuthEnvelope(200, registration, BeginRegistrationVerificationResponse, directSuccess),
    ).toEqual({ value: registration, private: undefined });
  });

  it("accepts the direct registration-verification grant payload", () => {
    const grant = { grant: "registration-grant" };

    expect(
      decodeAuthEnvelope(200, grant, CompleteRegistrationVerificationResponse, directSuccess),
    ).toEqual({ value: grant, private: undefined });
  });

  it.each([
    undefined,
    null,
    "ok",
    { status: "ok" },
    { status: "ok", emailSent: "yes" },
    { status: "failed", emailSent: true },
    { _tag: "Success", value: { status: "ok" } },
  ])("rejects malformed direct registration-verification success %#", (responseBody) => {
    expect(() =>
      decodeAuthEnvelope(200, responseBody, BeginRegistrationVerificationResponse, directSuccess),
    ).toThrow(expect.objectContaining({ _tag: "AuthResponseError" }));
  });

  it("does not accept direct payloads for auth-envelope endpoints", () => {
    expect(() =>
      decodeAuthEnvelope(200, registration, BeginRegistrationVerificationResponse),
    ).toThrow(expect.objectContaining({ _tag: "AuthResponseError" }));
  });

  it("returns a typed failure for a malformed successful session", () => {
    expect(() =>
      decodeAuthEnvelope(
        200,
        { _tag: "Success", value: { ...session, subjectId: 42 } },
        Schema.NullOr(PreloadedSession),
      ),
    ).toThrow(expect.objectContaining({ _tag: "AuthResponseError" }));
  });

  it("keeps tagged auth failures structured", () => {
    expect(() =>
      decodeAuthEnvelope(
        403,
        {
          _tag: "Failure",
          error: {
            _tag: "StepUpRequired",
            message: "Confirm again",
            action: "backup-download",
            methods: ["totp"],
          },
        },
        Schema.NullOr(PreloadedSession),
      ),
    ).toThrow(
      expect.objectContaining({
        _tag: "StepUpRequired",
        action: "backup-download",
        methods: ["totp"],
      }),
    );
  });

  it("keeps direct Enterprise API failures structured", () => {
    expect(() =>
      decodeAuthEnvelope(
        400,
        {
          _tag: "EnterpriseBadRequest",
          message: "Enter your name and a valid email address.",
        },
        BeginRegistrationVerificationResponse,
        directSuccess,
      ),
    ).toThrow(
      expect.objectContaining({
        _tag: "EnterpriseBadRequest",
        message: "We couldn't complete that request. Try again.",
      }),
    );
  });

  it("keeps a non-2xx status authoritative over a valid direct payload", () => {
    expect(() =>
      decodeAuthEnvelope(503, registration, BeginRegistrationVerificationResponse, directSuccess),
    ).toThrow(
      expect.objectContaining({
        message: "We couldn't complete that request. Try again.",
      }),
    );
  });

  it("does not reinterpret a failure envelope as direct success", () => {
    expect(() =>
      decodeAuthEnvelope(
        200,
        { _tag: "Failure", error: { _tag: "EmailRejected", message: "Code rejected" } },
        Schema.Json,
        directSuccess,
      ),
    ).toThrow(
      expect.objectContaining({
        _tag: "EmailRejected",
        message: "We couldn't complete that request. Try again.",
      }),
    );
  });
});
