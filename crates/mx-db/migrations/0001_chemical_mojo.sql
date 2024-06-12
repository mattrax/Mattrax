CREATE TABLE `kv` (
	`key` varchar(256) NOT NULL,
	`value` varbinary(9068) NOT NULL,
	`last_modified` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `kv_key` PRIMARY KEY(`key`)
);
