import { Layer } from "effect";
import { Domain } from "./domain.ts";
import { Approval } from "./Approval/Approval.aggregate.ts";
import { ApprovalDetail, ApprovalDetailLive } from "./Approval/ApprovalDetail.view.ts";
import { ApprovalExpiry, ApprovalExpiryLive } from "./Approval/ApprovalExpiry.policy.ts";
import { ApprovalIndex, ApprovalIndexLive } from "./Approval/ApprovalIndex.projection.ts";
import { ApprovalQueue, ApprovalQueueLive } from "./Approval/ApprovalQueue.query.ts";
import { MemoryApprovalIndexStore } from "./Approval/ApprovalIndexStore.ts";

/**
 * One model, one language. In the real port this would be the enterprise
 * bounded context; the POC models the approvals subdomain only.
 */
export class Enterprise extends Domain.Model("Enterprise", {
  aggregates: [Approval],
  views: [ApprovalDetail],
  policies: [ApprovalExpiry],
  projections: [ApprovalIndex],
  queries: [ApprovalQueue],
}) {}

/** Every policy, projection and query implementation, as one Layer. */
export const EnterpriseHandlers = Layer.mergeAll(
  ApprovalDetailLive,
  ApprovalExpiryLive,
  ApprovalIndexLive,
  ApprovalQueueLive,
);

/**
 * The hosted model on whatever platform is provided. The store is a port, so
 * the host swaps one Layer to move the queue from memory to MySQL.
 */
export const EnterpriseLive = Enterprise.layer(EnterpriseHandlers).pipe(
  Layer.provide(MemoryApprovalIndexStore),
);
