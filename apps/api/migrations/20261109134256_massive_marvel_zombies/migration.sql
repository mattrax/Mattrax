CREATE TABLE `platform_instance` (
	`id` varchar(255) PRIMARY KEY,
	`key_prefix` varchar(255) NOT NULL,
	`key_hash` varchar(255) NOT NULL,
	`description` text,
	`issued_by_user_id` varchar(255) NOT NULL,
	`user_count` int NOT NULL DEFAULT 0,
	`device_count` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3),
	`revoked_at` datetime(3),
	CONSTRAINT `platform_instance_key_hash_unique` UNIQUE INDEX(`key_hash`),
	CONSTRAINT `platform_instance_issued_by_user_id_user_id_fkey` FOREIGN KEY (`issued_by_user_id`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
CREATE INDEX `platform_instance_issued_by_idx` ON `platform_instance` (`issued_by_user_id`);