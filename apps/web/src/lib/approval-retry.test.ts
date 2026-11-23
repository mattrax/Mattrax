import { describe, expect, it } from "vitest";
import {
  ApprovalRequiredError,
  approvalHeaders,
  approvalRetryFor,
  clearApprovalRetry,
  registerApprovalRetry,
} from "./approval-retry";
import { approvalFailure } from "./errors";

describe("approval client helpers", () => {
  it("threads the approval id and break-glass reason into request headers", () => {
    expect(approvalHeaders()).toEqual({});
    expect(approvalHeaders({ approvalId: "request-1" })).toEqual({
      "x-mattrax-approval": "request-1",
    });
    expect(approvalHeaders({ breakGlassReason: "owner incident" })).toEqual({
      "x-mattrax-approval-break-glass": "owner incident",
    });
  });

  it("remembers the blocked call so an approved request can replay it", async () => {
    const calls: Array<string | undefined> = [];

    registerApprovalRetry({
      requestId: "request-2",
      action: "policy.delete",
      retry: async (input) => {
        calls.push(input.approvalId);
      },
    });

    const retry = approvalRetryFor("request-2");

    expect(retry?.action).toBe("policy.delete");
    await retry?.retry({ approvalId: "request-2" });
    expect(calls).toEqual(["request-2"]);

    clearApprovalRetry("request-2");
    expect(approvalRetryFor("request-2")).toBeUndefined();
  });

  it("carries the request handle on the typed client error", () => {
    const error = new ApprovalRequiredError({
      message: "Approval request request-3 is approved — retry with this approval.",
      requestId: "request-3",
      status: "approved",
    });

    expect(error.name).toBe("ApprovalRequiredError");
    expect(error.requestId).toBe("request-3");
    expect(error.status).toBe("approved");
  });

  it("reads the handle from a tagged or wrapped API failure", () => {
    expect(
      approvalFailure({ _tag: "ApprovalRequired", requestId: "request-4", status: "pending" }),
    ).toEqual({ requestId: "request-4", status: "pending" });

    expect(
      approvalFailure({
        _tag: "HttpClientError",
        error: { _tag: "ApprovalRequired", requestId: "request-5", status: "approved" },
      }),
    ).toEqual({ requestId: "request-5", status: "approved" });

    expect(
      approvalFailure(
        JSON.stringify({
          _tag: "ApprovalRequired",
          requestId: "request-6",
          status: "pending",
        }),
      ),
    ).toEqual({ requestId: "request-6", status: "pending" });
  });
});
