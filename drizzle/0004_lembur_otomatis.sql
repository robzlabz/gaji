ALTER TABLE "organizations" ADD COLUMN "normal_hours_per_day" numeric(4, 2) DEFAULT '7.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "working_days_per_week" smallint DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "overtime_first_multiplier" numeric(4, 2) DEFAULT '1.50' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "overtime_next_multiplier" numeric(4, 2) DEFAULT '2.00' NOT NULL;