CREATE TABLE `realtime_event` (
	`seq` bigint AUTO_INCREMENT PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`kind` varchar(32) NOT NULL,
	`device_id` varchar(255),
	`protocol` varchar(16),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `realtime_event_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `realtime_event_organization_seq_idx` ON `realtime_event` (`organization_id`,`seq`);--> statement-breakpoint
CREATE INDEX `realtime_event_created_idx` ON `realtime_event` (`created_at`);