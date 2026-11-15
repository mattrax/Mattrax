ALTER TABLE `scep_ca` ADD `organization_id` varchar(255);--> statement-breakpoint
ALTER TABLE `scep_ca` ADD `source` varchar(16) DEFAULT 'generated' NOT NULL;--> statement-breakpoint
ALTER TABLE `scep_ca` ADD `rotated_at` datetime(3);--> statement-breakpoint
-- Attribute the legacy deployment-wide CA to every tenant that already used it,
-- so existing identities keep renewing and devices stay trusted. Rows are
-- copied before the shared row is removed; `id` auto-increments.
INSERT INTO `scep_ca` (`organization_id`, `cert_pem`, `private_key_jwk`, `source`, `created_at`, `rotated_at`)
SELECT tenants.organization_id, legacy.cert_pem, legacy.private_key_jwk, 'generated', legacy.created_at, NULL
FROM `scep_ca` AS legacy
CROSS JOIN (
  SELECT DISTINCT enrollment.organization_id
  FROM `enterprise_enrollment` AS enrollment
  INNER JOIN `organization` AS tenant ON tenant.id = enrollment.organization_id
  UNION
  SELECT DISTINCT certificate.organization_id
  FROM `scep_issued_certificate` AS certificate
  INNER JOIN `organization` AS tenant ON tenant.id = certificate.organization_id
) AS tenants
WHERE legacy.organization_id IS NULL;--> statement-breakpoint
DELETE FROM `scep_ca` WHERE `organization_id` IS NULL;--> statement-breakpoint
ALTER TABLE `scep_ca` MODIFY `organization_id` varchar(255) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `scep_ca_organization_unique` ON `scep_ca` (`organization_id`);--> statement-breakpoint
ALTER TABLE `scep_ca` ADD CONSTRAINT `scep_ca_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;