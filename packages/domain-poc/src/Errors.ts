import { Schema } from "effect";
import { Domain } from "./domain.ts";

export class Unauthorized extends Domain.Rejection(
  "Unauthorized",
  {},
  { httpApiStatus: 401, description: "No signed-in administrator on the request." },
) {}

export class NotFound extends Domain.Rejection(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class ApprovalForbidden extends Domain.Rejection(
  "ApprovalForbidden",
  { message: Schema.String },
  { httpApiStatus: 403 },
) {}
