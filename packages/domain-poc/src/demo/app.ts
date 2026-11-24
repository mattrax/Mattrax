import { Layer } from "effect";
import * as DomainHttp from "@alchemy.run/domain/Http";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { NodeFileSystem, NodeHttpPlatform, NodePath } from "@effect/platform-node";
import * as Etag from "effect/http/Etag";
import * as HttpRouter from "effect/http/HttpRouter";
import { ApprovalApi } from "../Approval.api.ts";
import { ApprovalRuntimeLive } from "../host/Runtime.ts";

/**
 * The same Api, published as a plain HTTP JSON API with an OpenAPI document.
 *
 * The endpoints, payload decoding, error statuses, SSE watch stream and the
 * spec all come from the model's declarations. Nothing here decides what a
 * caller may see.
 */
export const ApprovalHttp = DomainHttp.toHttpApi(ApprovalApi, {
  expose: [
    "RequestApproval",
    "ApproveApproval",
    "RejectApproval",
    "CancelApproval",
    "ConsumeApproval",
    "ApprovalDetail.get",
    "ApprovalDetail.watch",
    "ApprovalQueue",
  ],
});

export const ApprovalApp = HttpApiBuilder.layer(ApprovalHttp.api, {
  openapiPath: "/openapi.json",
}).pipe(
  Layer.provide(ApprovalHttp.layer),
  Layer.provide(ApprovalRuntimeLive),
  Layer.provide(
    Layer.mergeAll(NodeHttpPlatform.layer, NodeFileSystem.layer, NodePath.layer, Etag.layer),
  ),
);

const app = HttpRouter.toWebHandler(ApprovalApp, { disableLogger: true });

export const handler = app.handler;
export const dispose = app.dispose;
