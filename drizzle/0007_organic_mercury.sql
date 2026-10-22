CREATE TABLE `invoice_versions` (
	`owner` text NOT NULL,
	`invoice_id` text NOT NULL,
	`revision` integer NOT NULL,
	`action` text NOT NULL,
	`note` text,
	`data` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `invoice_id`, `revision`)
);
