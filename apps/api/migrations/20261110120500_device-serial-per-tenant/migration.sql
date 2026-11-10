ALTER TABLE `device` DROP INDEX `device_serial_unique`;
--> statement-breakpoint
ALTER TABLE `device` ADD UNIQUE INDEX `device_organization_serial_unique` (`organization_id`,`serial`);
