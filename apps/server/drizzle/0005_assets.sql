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
-- The schema declares onDelete: "restrict" on all four columns, but SQLite's
-- ALTER TABLE ADD COLUMN cannot carry an ON DELETE clause — only a table-level FOREIGN
-- KEY can, and that would mean rebuilding a table of hand-entered receipts. The omitted
-- clause defaults to NO ACTION, which for these immediate (non-deferred) constraints
-- refuses the delete exactly as RESTRICT does; test/assets.test.ts pins that. The two
-- differ only for deferred constraints, which nothing here uses.
ALTER TABLE `transactions` ADD `from_account_id` integer REFERENCES `accounts`(`id`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `to_account_id` integer REFERENCES `accounts`(`id`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `from_holding_id` integer REFERENCES `holdings`(`id`);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `to_holding_id` integer REFERENCES `holdings`(`id`);
