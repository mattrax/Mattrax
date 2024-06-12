ALTER TABLE `devices` ADD `mdm_id` varchar(24) NOT NULL;
ALTER TABLE `devices` ADD CONSTRAINT `devices_mdm_id_unique` UNIQUE(`mdm_id`);