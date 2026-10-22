ALTER TABLE `invoice_line_items` ADD `product_code` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `discount_printed` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `discount_basis` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `vat_rate` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `vat_amount` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `gross_line_amount` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `source_page` integer;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `printed_evidence` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `value_origin` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `document_type` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `receiver` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `source_page` integer;