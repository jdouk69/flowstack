ALTER TABLE `invoice_line_items` ADD `discount_amount_printed` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `line_amount_basis` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `unit_price_basis` text;--> statement-breakpoint
ALTER TABLE `invoice_line_items` ADD `amount_basis_evidence` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `subtotal_before_discount` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `invoice_discount_printed` text;