CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`is_fixed` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);--> statement-breakpoint
CREATE TABLE `line_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`transaction_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`category_id` integer,
	`is_fixed_override` integer,
	`note` text,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `line_items_transaction_idx` ON `line_items` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `line_items_category_idx` ON `line_items` (`category_id`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name_norm` text NOT NULL,
	`default_category_id` integer,
	`seen_count` integer DEFAULT 0 NOT NULL,
	`last_seen_at` integer,
	FOREIGN KEY (`default_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_name_norm_unique` ON `merchants` (`name_norm`);--> statement-breakpoint
CREATE INDEX `merchants_name_norm_idx` ON `merchants` (`name_norm`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurred_on` integer NOT NULL,
	`type` text NOT NULL,
	`total_minor` integer NOT NULL,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`fx_rate` integer,
	`merchant_raw` text,
	`merchant_id` integer,
	`payer` text,
	`scope` text,
	`account` text,
	`note` text,
	`dedup_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_dedup_hash_idx` ON `transactions` (`dedup_hash`);--> statement-breakpoint
CREATE INDEX `transactions_occurred_on_idx` ON `transactions` (`occurred_on`);--> statement-breakpoint
CREATE INDEX `transactions_merchant_idx` ON `transactions` (`merchant_id`);