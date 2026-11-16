CREATE TABLE `sso_identity` (
	`organization_id` varchar(255) NOT NULL,
	`object_id` varchar(255) NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`object_id`),
	CONSTRAINT `sso_identity_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `sso_identity_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
