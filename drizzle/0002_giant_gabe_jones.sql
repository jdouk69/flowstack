CREATE TABLE `invoice_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`invoice_id` text NOT NULL,
	`position` integer NOT NULL,
	`printed_name` text,
	`description` text,
	`quantity` text,
	`unit` text,
	`unit_price` text,
	`line_amount` text,
	`source_references` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_line_position` ON `invoice_line_items` (`owner`,`invoice_id`,`position`);--> statement-breakpoint
CREATE INDEX `invoice_line_owner` ON `invoice_line_items` (`owner`,`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`source_document_id` text NOT NULL,
	`supplier_key` text,
	`supplier_name` text,
	`invoice_date` text,
	`invoice_number` text,
	`account_information` text,
	`customer_information` text,
	`project_information` text,
	`printed_names` text,
	`subtotal` text,
	`vat` text,
	`invoice_total` text,
	`currency` text,
	`analysis_status` text DEFAULT 'awaiting_analysis' NOT NULL,
	`analysis_error` text,
	`audit_status` text DEFAULT 'not_started' NOT NULL,
	`audit_flag` text,
	`audit_reasons` text,
	`duplicate_of` text,
	`created` text NOT NULL,
	`updated` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_source_owner` ON `invoices` (`owner`,`source_document_id`);--> statement-breakpoint
CREATE INDEX `invoice_owner_created` ON `invoices` (`owner`,`created`,`id`);