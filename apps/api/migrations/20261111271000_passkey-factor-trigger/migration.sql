-- Keep `user.passkey_enabled` authoritative at the database level. The passkey
-- persistence owner inserts and deactivates `auth_passkeyCredentials` rows
-- directly, so the sign-in requirement (which only reads the subject row) must
-- not depend on application code remembering to mirror the state. The auth
-- lifecycle hook also updates the column; these triggers make the outcome
-- identical even when that hook is retried or fails.
CREATE TRIGGER `auth_passkey_factor_insert` AFTER INSERT ON `auth_passkeyCredentials` FOR EACH ROW UPDATE `user` SET `passkey_enabled` = EXISTS(SELECT 1 FROM `auth_passkeyCredentials` `p` WHERE `p`.`subject_id` = NEW.`subject_id` AND `p`.`active` = TRUE) WHERE `id` = NEW.`subject_id`;
--> statement-breakpoint
CREATE TRIGGER `auth_passkey_factor_update` AFTER UPDATE ON `auth_passkeyCredentials` FOR EACH ROW UPDATE `user` SET `passkey_enabled` = EXISTS(SELECT 1 FROM `auth_passkeyCredentials` `p` WHERE `p`.`subject_id` = NEW.`subject_id` AND `p`.`active` = TRUE) WHERE `id` = NEW.`subject_id`;
--> statement-breakpoint
CREATE TRIGGER `auth_passkey_factor_delete` AFTER DELETE ON `auth_passkeyCredentials` FOR EACH ROW UPDATE `user` SET `passkey_enabled` = EXISTS(SELECT 1 FROM `auth_passkeyCredentials` `p` WHERE `p`.`subject_id` = OLD.`subject_id` AND `p`.`active` = TRUE) WHERE `id` = OLD.`subject_id`;
