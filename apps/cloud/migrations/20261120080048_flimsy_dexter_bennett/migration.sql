CREATE TABLE `google_directory_sync` (
	`organization_id` varchar(255) PRIMARY KEY,
	`enabled` boolean NOT NULL DEFAULT false,
	`admin_email` varchar(255),
	`customer` varchar(255),
	`service_account_email` varchar(255),
	`sealed_service_account` text,
	`last_synced_at` datetime(3),
	`last_attempted_at` datetime(3),
	`last_error` text,
	`last_counts` json,
	`status` varchar(32) NOT NULL DEFAULT 'idle',
	`sync_interval_minutes` int NOT NULL DEFAULT 0,
	`next_sync_at` datetime(3),
	`last_run_trigger` varchar(16),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `google_directory_sync_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
