import type { ApprovalState } from "./Approval.aggregate.ts";
import type { ApprovalStatus } from "./ApprovalAction.ts";

/** The status a state has, for rejections and replies. */
export const approvalStatusOf = (state: ApprovalState): ApprovalStatus => {
  switch (state._tag) {
    case "Unrequested":
    case "Pending":
      return "pending";
    case "Approved":
      return "approved";
    case "Rejected":
      return "rejected";
    case "Expired":
      return "expired";
    case "Cancelled":
      return "cancelled";
  }
};

export const approvalReceived = (state: ApprovalState): number =>
  state._tag === "Unrequested"
    ? 0
    : state.decisions.filter((decision) => decision.decision === "approve").length;
