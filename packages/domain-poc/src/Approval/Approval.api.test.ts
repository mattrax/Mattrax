import { describe, expect, it } from "vitest";
import { Effect, Layer, Schedule } from "effect";
import { Actor } from "../Actor.ts";
import { ApprovalApi } from "../Approval.api.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { EnterpriseLive } from "../Enterprise.model.ts";
import { Domain } from "../domain.ts";
import { Unauthorized } from "../Errors.ts";
import { ApprovalId } from "./Approval.id.ts";
import { Session } from "../Session.middleware.ts";

/**
 * The Api test the framework recommends: host the model in memory, drive it
 * through the same typed client a Worker uses, and let the real middleware run.
 * This is the layer where a port would find contract drift — the client sees
 * exactly what the Api declares, not the handler's internals.
 */
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

const as = (actor: Actor) =>
  Layer.succeed(Session, (effect) => Effect.provideService(effect, CurrentActor, actor));

const signedOut = Layer.succeed(Session, (_effect) => Effect.fail(new Unauthorized()));

const Host = EnterpriseLive.pipe(Layer.provide(Domain.InMemory));

describe("ApprovalApi", () => {
  it("round-trips a request, a decision and the queue", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const samClient = yield* ApprovalApi.clientInProcess.pipe(Effect.provide(as(sam)));
        const receipt = yield* samClient.RequestApproval(ApprovalId.make("api-1"), {
          action: "tenant.delete",
          policyId: "policy-1",
          payloadHash: "hash-1",
          approvalsRequired: 1,
          expiresInMs: 60_000,
        });

        const pending = yield* samClient.ApprovalDetail.get(ApprovalId.make("api-1"), {
          atLeast: receipt,
        });
        expect(pending?.status).toBe("pending");

        const alexClient = yield* ApprovalApi.clientInProcess.pipe(Effect.provide(as(alex)));
        const approvedReceipt = yield* alexClient.ApproveApproval(ApprovalId.make("api-1"), {});

        const approved = yield* samClient.ApprovalDetail.get(ApprovalId.make("api-1"), {
          atLeast: approvedReceipt,
        });
        expect(approved?.status).toBe("approved");
        expect(approved?.decisions).toHaveLength(1);

        // NOTE: `atLeast` does not wait for a projection whose `from` is a view:
        // the projection's caughtUp only traces aggregate sources, so it sees
        // the receipt as consuming nothing. Poll instead until the batch lands.
        // Projecting straight from the aggregate would make read-your-write work.
        const page = yield* Effect.gen(function* () {
          const page = yield* samClient.ApprovalQueue({});
          return page.entries.length > 0 ? page : yield* Effect.fail("projection-not-ready");
        }).pipe(Effect.retry({ schedule: Schedule.spaced("25 millis"), times: 40 }));

        expect(page.entries.map((row) => row.status)).toEqual(["approved"]);
      }).pipe(Effect.scoped, Effect.provide(Host)),
    ));

  it("refuses a caller with no session before any handler runs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const client = yield* ApprovalApi.clientInProcess.pipe(Effect.provide(signedOut));
        const error = yield* client.ApprovalDetail.get(ApprovalId.make("missing")).pipe(
          Effect.flip,
        );
        expect(error._tag).toBe("Unauthorized");
      }).pipe(Effect.scoped, Effect.provide(Host)),
    ));
});
