-- Existing organizations are backfilled to revision 0 by the non-null default.
-- Rollout: apply both revision migrations, deploy this receiver, then deploy services.
ALTER TABLE `organization` ADD `billing_entitlement_revision` bigint DEFAULT 0 NOT NULL;
