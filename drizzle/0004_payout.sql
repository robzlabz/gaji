ALTER TABLE "employees" ADD COLUMN "bank_code" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_account_number" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "transferred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "transferred_by" uuid;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_transferred_by_user_id_fk" FOREIGN KEY ("transferred_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
