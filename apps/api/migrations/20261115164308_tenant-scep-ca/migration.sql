ALTER TABLE `scep_ca` ADD `organization_id` varchar(255);--> statement-breakpoint
ALTER TABLE `scep_ca` ADD `source` varchar(16) DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE `scep_ca` ADD `rotated_at` datetime(3);--> statement-breakpoint
-- Attribute the legacy deployment-wide CA to every tenant so no enrolled
-- device loses its trust anchor. The key material is still shared: per-tenant
-- isolation starts when each tenant rotates its CA (Settings -> Enrollment ->
-- rotate), which revokes only that tenant's identities.
INSERT INTO `scep_ca` (`organization_id`, `cert_pem`, `private_key_jwk`, `source`, `created_at`, `rotated_at`)
SELECT tenants.id, legacy.cert_pem, legacy.private_key_jwk, 'imported', legacy.created_at, NULL
FROM `scep_ca` AS legacy
CROSS JOIN `organization` AS tenants
WHERE legacy.organization_id IS NULL;--> statement-breakpoint
DELETE FROM `scep_ca` WHERE `organization_id` IS NULL;--> statement-breakpoint
ALTER TABLE `scep_ca` MODIFY `organization_id` varchar(255) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `scep_ca_organization_unique` ON `scep_ca` (`organization_id`);--> statement-breakpoint
ALTER TABLE `scep_ca` ADD CONSTRAINT `scep_ca_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;