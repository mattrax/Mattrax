DROP TABLE `windows_ephemeral_state`;
ALTER TABLE `devices` ADD `enrolled_by` bigint unsigned NOT NULL;