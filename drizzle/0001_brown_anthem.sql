CREATE TABLE `document_content` (
	`owner` text NOT NULL,
	`workflow` text NOT NULL,
	`hash` text NOT NULL,
	`document_id` text NOT NULL,
	PRIMARY KEY(`owner`, `workflow`, `hash`)
);
