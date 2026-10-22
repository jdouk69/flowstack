CREATE TABLE `invoice_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`invoice_id` text NOT NULL,
	`action` text NOT NULL,
	`note` text,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invoice_event_owner` ON `invoice_events` (`owner`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoice_ledger` (
	`owner` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `identity_key` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `audit_ledger_revision` integer;--> statement-breakpoint
ALTER TABLE `invoices` ADD `review_note` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `reviewed_at` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `approved_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_approved_identity` ON `invoices` (`owner`,`identity_key`) WHERE audit_status = 'approved';