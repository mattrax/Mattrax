-- Existing organizations are backfilled to revision 0 by the non-null default.
-- Rollout: apply both migrations, deploy services, drain old instances, deploy this receiver, then reconcile.
ALTER TABLE `organization` ADD `billing_entitlement_revision` bigint DEFAULT 0 NOT NULL;
