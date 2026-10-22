ALTER TABLE `invoices` ADD `capture_method` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `capture_token` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `revision` integer DEFAULT 0 NOT NULL;