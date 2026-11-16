CREATE TABLE `apple_push_key` (
	`organization_id` varchar(255) PRIMARY KEY,
	`encrypted_private_key_jwk` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `apple_push_key_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`)
);
