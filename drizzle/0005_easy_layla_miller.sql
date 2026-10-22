CREATE TABLE `document_analysis` (
	`owner` text NOT NULL,
	`document_id` text NOT NULL,
	`pages` text NOT NULL,
	`analysis` text NOT NULL,
	`revision` integer NOT NULL,
	`marker` text NOT NULL,
	`created` text NOT NULL,
	`updated` text NOT NULL,
	PRIMARY KEY(`owner`, `document_id`)
);
--> statement-breakpoint
CREATE TABLE `document_analysis_versions` (
	`owner` text NOT NULL,
	`document_id` text NOT NULL,
	`revision` integer NOT NULL,
	`pages` text NOT NULL,
	`analysis` text NOT NULL,
	`created` text NOT NULL,
	PRIMARY KEY(`owner`, `document_id`, `revision`)
);
