-- Existing subscriptions are backfilled to revision 0 by the non-null default.
-- Rollout: apply both revision migrations, deploy the Cloud receiver, then deploy services.
ALTER TABLE `services_subscription` ADD `entitlement_revision` bigint DEFAULT 0 NOT NULL;
