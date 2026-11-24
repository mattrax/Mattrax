import { Layer } from "effect";
import { Domain } from "../domain.ts";
import { EnterpriseLive } from "../Enterprise.model.ts";
import { SessionLive } from "./Session.ts";

/**
 * The POC's whole runtime: the hosted model, the platform, and the Session
 * middleware. Swap `Domain.InMemory` for `DomainCloudflare.layerDurableObjects()`
 * and nothing in the model changes; that is the point of the exercise.
 */
export const ApprovalRuntimeLive = Layer.mergeAll(EnterpriseLive, SessionLive).pipe(
  Layer.provide(Domain.InMemory),
);
