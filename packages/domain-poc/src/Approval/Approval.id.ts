import { Schema } from "effect";

export const ApprovalId = Schema.String.pipe(Schema.brand("ApprovalId"));
export type ApprovalId = typeof ApprovalId.Type;
