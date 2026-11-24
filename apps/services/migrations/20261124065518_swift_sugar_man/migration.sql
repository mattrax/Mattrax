-- Existing subscriptions are backfilled to revision 0 by the non-null default.
-- Rollout: apply both migrations, deploy services, drain old instances, deploy Cloud, then reconcile.
ALTER TABLE `services_subscription` ADD `entitlement_revision` bigint DEFAULT 0 NOT NULL;
