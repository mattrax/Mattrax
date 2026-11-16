ALTER TABLE `scep_issued_certificate` ADD `revoked_at` datetime(3);--> statement-breakpoint
CREATE INDEX `scep_issued_certificate_device_idx` ON `scep_issued_certificate` (`device_id`);