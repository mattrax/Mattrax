-- Command lifecycle: expiry index and the deferred status rename.
--
-- `device_command.dedupe_key` and `expires_at` were added by the previous
-- migration (the generator batched them with the device-inventory columns);
-- this one completes the lifecycle by widening the status/expiry index and
-- renaming the stored `not-now` status to `deferred`.
--
-- Index and data change are kept in one ALTER plus an UPDATE so MySQL applies
-- them atomically.
ALTER TABLE `device_command`
	DROP INDEX `device_command_device_status_idx`,
	ADD INDEX `device_command_device_status_idx` (`device_id`,`status`,`expires_at`);
--> statement-breakpoint
UPDATE `device_command` SET `status` = 'deferred' WHERE `status` = 'not-now';
