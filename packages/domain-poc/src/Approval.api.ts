import { Domain } from "./domain.ts";
import { Enterprise } from "./Enterprise.model.ts";

/**
 * The approvals surface, as a client sees it.
 *
 * The same declaration gives three clients for free: a typed in-process client
 * for the Worker, an HTTP JSON API plus OpenAPI (@alchemy.run/domain/Http),
 * and MCP tools — with the middleware, payload decoding and typed rejections
 * applied once, in the model.
 */
export class ApprovalApi extends Domain.Api(
  "ApprovalApi",
  {
    model: Enterprise,
    commands: [
      "RequestApproval",
      "ApproveApproval",
      "RejectApproval",
      "CancelApproval",
      "ConsumeApproval",
    ],
    views: ["ApprovalDetail"],
    queries: ["ApprovalQueue"],
  },
  { description: "Four-eyes approvals over destructive tenant actions." },
) {}
