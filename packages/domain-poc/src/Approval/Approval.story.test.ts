import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { Layer } from "effect";
import { Story } from "@alchemy.run/domain/Story";
import { Domain, Enterprise, EnterpriseHandlers } from "../index.ts";
import {
  Actor,
  Approval,
  ApprovalApproved,
  ApprovalCancelled,
  ApprovalConsumed,
  ApprovalDecisionRecorded,
  ApprovalDetail,
  ApprovalExpired,
  ApprovalForbidden,
  ApprovalNotPending,
  ApprovalQueue,
  ApprovalRejected,
  ApprovalRequested,
  ApproveApproval,
  AlreadyConsumed,
  AlreadyDecided,
  CancelApproval,
  ConsumeApproval,
  CredentialCannotDecide,
  CurrentActor,
  MemoryApprovalIndexStore,
  NotFound,
  NoteRequired,
  NotRequester,
  PayloadMismatch,
  RejectApproval,
  RequestApproval,
  SelfDecision,
} from "../index.ts";

const T = Date.parse("2026-11-24T09:00:00.000Z");
const story = Story.make(Enterprise, {
  layer: EnterpriseHandlers.pipe(Layer.provide(MemoryApprovalIndexStore)),
});

const sam: Actor = {
  accountId: "acc-sam" as Actor["accountId"],
  tenantId: "ten-1" as Actor["tenantId"],
  role: "owner",
  permissions: ["approvals.read", "approvals.write"],
  credential: false,
};

const alex: Actor = {
  ...sam,
  accountId: "acc-alex" as Actor["accountId"],
  role: "admin",
};

const robin: Actor = {
  ...sam,
  accountId: "acc-robin" as Actor["accountId"],
  role: "admin",
};

const auditor: Actor = {
  ...sam,
  accountId: "acc-auditor" as Actor["accountId"],
  role: "auditor",
  permissions: ["approvals.read"],
};

const member: Actor = {
  ...sam,
  accountId: "acc-member" as Actor["accountId"],
  role: "member",
  permissions: [],
};

const token: Actor = { ...sam, accountId: "acc-token" as Actor["accountId"], credential: true };

const otherTenant: Actor = { ...alex, tenantId: "ten-2" as Actor["tenantId"] };

const approval = Approval.ref("ap-1");

const as = (actor: Actor) => Story.provide(CurrentActor, actor);

const requested = (
  overrides: Partial<{
    approvalsRequired: number;
    payloadHash: string;
    expiresInMs: number;
    scopeType: "tenant" | "group" | "device";
    scopeId: string | null;
  }> = {},
) => {
  const expiresInMs = overrides.expiresInMs ?? 60_000;

  return new ApprovalRequested({
    tenantId: sam.tenantId,
    action: "tenant.delete",
    policyId: "policy-1",
    scopeType: overrides.scopeType ?? "tenant",
    scopeId: overrides.scopeId ?? null,
    requestedBy: sam.accountId,
    approvalsRequired: overrides.approvalsRequired ?? 2,
    approverPermission: null,
    approverRole: null,
    payloadHash: overrides.payloadHash ?? "hash-1",
    payloadSummary: {},
    expiresAt: T + expiresInMs,
    requestedAt: T,
  });
};

const request = (overrides: Parameters<typeof requested>[0] = {}) =>
  new RequestApproval({
    action: "tenant.delete",
    policyId: "policy-1",
    payloadHash: overrides.payloadHash ?? "hash-1",
    approvalsRequired: overrides.approvalsRequired ?? 2,
    expiresInMs: overrides.expiresInMs ?? 60_000,
    scopeType: overrides.scopeType ?? "tenant",
    scopeId: overrides.scopeId ?? null,
  });

const decision = (actor: Actor, kind: "approve" | "reject", note: string | null = null) =>
  new ApprovalDecisionRecorded({
    tenantId: sam.tenantId,
    approverId: actor.accountId,
    decision: kind,
    note,
    at: T,
  });

const approvedEvent = new ApprovalApproved({ at: T });

describe("the model", () => {
  it("is well defined", () => {
    expect(Domain.verify(Enterprise)).toEqual([]);
  });
});

describe("approvals", () => {
  it("needs every configured signature, then reports approved", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request()),
        Story.then(approval, requested()),
        Story.replied({ expiresAt: T + 60_000 }),
        Story.view(ApprovalDetail, approval, { status: "pending", approvalsRequired: 2 }),

        as(alex),
        Story.when(approval, new ApproveApproval({ note: "looks right" })),
        Story.then(approval, decision(alex, "approve", "looks right")),
        Story.replied({ status: "pending", approvalsReceived: 1, approvalsRequired: 2 }),
        Story.view(ApprovalDetail, approval, { status: "pending" }),

        as(robin),
        Story.when(approval, new ApproveApproval()),
        Story.then(approval, Story.inOrder(decision(robin, "approve", null), approvedEvent)),
        Story.replied({ status: "approved", approvalsReceived: 2, approvalsRequired: 2 }),
        Story.view(ApprovalDetail, approval, { status: "approved", approvedAt: T }),
        Story.query(ApprovalQueue, {}, [
          {
            id: "ap-1",
            status: "approved",
            approvalsReceived: 2,
            approvalsRequired: 2,
          },
        ]),
      ),
    ));

  it("refuses a requester approving their own request", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request()),
        Story.then(approval, requested()),
        Story.when(approval, new ApproveApproval()),
        Story.rejected(new SelfDecision({ message: "You cannot approve your own request." })),
        Story.view(ApprovalDetail, approval, { status: "pending" }),
      ),
    ));

  it("refuses one administrator deciding twice", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request()),
        Story.then(approval, requested()),
        as(alex),
        Story.when(approval, new ApproveApproval()),
        Story.then(approval, decision(alex, "approve")),
        Story.when(approval, new ApproveApproval()),
        Story.rejected(new AlreadyDecided()),
      ),
    ));

  it("refuses an API token, and an approver from another tenant", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request()),
        Story.then(approval, requested()),
        as(token),
        Story.when(approval, new ApproveApproval()),
        Story.rejected(
          new CredentialCannotDecide({
            message: "API tokens cannot approve requests. Sign in to decide.",
          }),
        ),
        as(otherTenant),
        Story.when(approval, new ApproveApproval()),
        Story.rejected(new NotFound({ message: "Approval not found" })),
      ),
    ));

  it("expires on its own deadline, without a sweep or a reader", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request({ expiresInMs: 60_000 })),
        Story.then(approval, requested({ expiresInMs: 60_000 })),
        Story.advance("2 minutes"),
        Story.then(approval, new ApprovalExpired({ at: T + 120_000 })),
        Story.view(ApprovalDetail, approval, { status: "expired" }),
        as(alex),
        Story.when(approval, new ApproveApproval()),
        Story.rejected(new ApprovalNotPending({ status: "expired" })),
      ),
    ));

  it("lets only the requester cancel, and refuses once decided", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request()),
        Story.then(approval, requested()),
        as(alex),
        Story.when(approval, new CancelApproval()),
        Story.rejected(
          new NotRequester({
            message: "Only the administrator who requested this approval can cancel it.",
          }),
        ),
        as(sam),
        Story.when(approval, new CancelApproval()),
        Story.then(approval, new ApprovalCancelled({ at: T })),
        Story.view(ApprovalDetail, approval, { status: "cancelled" }),
        Story.when(approval, new CancelApproval()),
        Story.rejected(new ApprovalNotPending({ status: "cancelled" })),
      ),
    ));

  it("requires a reason to reject", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request()),
        Story.then(approval, requested()),
        as(alex),
        Story.when(approval, new RejectApproval({ note: "  " })),
        Story.rejected(new NoteRequired()),
        Story.when(approval, new RejectApproval({ note: "not this week" })),
        Story.then(
          approval,
          Story.inOrder(decision(alex, "reject", "not this week"), new ApprovalRejected({ at: T })),
        ),
        Story.view(ApprovalDetail, approval, { status: "rejected" }),
      ),
    ));

  it("spends an approval once, and only for its own payload and requester", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request({ approvalsRequired: 1 })),
        Story.then(approval, requested({ approvalsRequired: 1 })),
        as(alex),
        Story.when(approval, new ApproveApproval()),
        Story.then(approval, Story.inOrder(decision(alex, "approve"), approvedEvent)),
        as(sam),
        Story.when(approval, new ConsumeApproval({ payloadHash: "wrong" })),
        Story.rejected(
          new PayloadMismatch({
            message: "This approval was issued for a different request. Start a new approval.",
          }),
        ),
        Story.when(approval, new ConsumeApproval({ payloadHash: "hash-1" })),
        Story.then(approval, new ApprovalConsumed({ at: T, payloadHash: "hash-1" })),
        Story.replied({ consumedAt: T }),
        Story.view(ApprovalDetail, approval, { status: "approved", consumedAt: T }),
        Story.when(approval, new ConsumeApproval({ payloadHash: "hash-1" })),
        Story.rejected(new AlreadyConsumed({ message: "This approval has already been used." })),
      ),
    ));

  it("refuses to spend another administrator's approval", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request({ approvalsRequired: 1 })),
        Story.then(approval, requested({ approvalsRequired: 1 })),
        as(alex),
        Story.when(approval, new ApproveApproval()),
        Story.then(approval, Story.inOrder(decision(alex, "approve"), approvedEvent)),
        Story.when(approval, new ConsumeApproval({ payloadHash: "hash-1" })),
        Story.rejected(
          new NotRequester({
            message: "Only the administrator who requested this approval can use it.",
          }),
        ),
      ),
    ));

  it("scopes the queue to the caller's tenant and permissions", () =>
    Effect.runPromise(
      story(
        Story.clock(T),
        as(sam),
        Story.when(approval, request({ approvalsRequired: 2 })),
        Story.then(approval, requested({ approvalsRequired: 2 })),
        Story.query(ApprovalQueue, {}, [{ id: "ap-1", status: "pending" }]),
        Story.query(ApprovalQueue, { mine: true }, [{ id: "ap-1" }]),

        as(auditor),
        Story.query(ApprovalQueue, {}, [{ id: "ap-1" }]),

        as(member),
        Story.query(ApprovalQueue, {}),
        Story.rejected(
          new ApprovalForbidden({
            message: "Your role does not include the approvals.read permission.",
          }),
        ),

        as(otherTenant),
        Story.query(ApprovalQueue, {}, []),
      ),
    ));
});
