ALTER TABLE `application` ADD `catalogue_title_id` varchar(255);--> statement-breakpoint
ALTER TABLE `application` ADD `catalogue_method_id` varchar(255);--> statement-breakpoint
ALTER TABLE `application` ADD `catalogue_target` varchar(255);--> statement-breakpoint
ALTER TABLE `application` ADD `catalogue_kind` varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX `application_catalogue_method_unique` ON `application` (`catalogue_title_id`,`organization_id`,`catalogue_method_id`);