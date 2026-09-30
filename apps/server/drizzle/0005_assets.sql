CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'PLN' NOT NULL,
	`balance_minor` integer DEFAULT 0 NOT NULL,
	`opening_minor` integer DEFAULT 0 NOT NULL,
	`opened_on` text,
	`rate_bp` integer,
	`promo_until` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`invested_minor` integer DEFAULT 0 NOT NULL,
	`value_minor` integer,
	`valued_at` text,
	`rate_bp` integer,
	`matures_on` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `from_account_id` integer REFERENCES `accounts`(`id`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `to_account_id` integer REFERENCES `accounts`(`id`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `from_holding_id` integer REFERENCES `holdings`(`id`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `to_holding_id` integer REFERENCES `holdings`(`id`);
