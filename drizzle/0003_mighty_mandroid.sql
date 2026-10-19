CREATE TABLE "wage_float_txns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"float_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"wage_amount" numeric(14, 2),
	"transport_amount" numeric(14, 2),
	"minutes" integer,
	"rate_used" numeric(14, 2),
	"occurred_at" date NOT NULL,
	"source_table" text,
	"source_id" uuid,
	"payslip_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wage_floats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "pay_rate_history_emp_idx";--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "transport_rate" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_rate_history" ADD COLUMN "kind" text DEFAULT 'wage' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "saldo_covered" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "transport_amount" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "wage_float_txns" ADD CONSTRAINT "wage_float_txns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_float_txns" ADD CONSTRAINT "wage_float_txns_float_id_wage_floats_id_fk" FOREIGN KEY ("float_id") REFERENCES "public"."wage_floats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_float_txns" ADD CONSTRAINT "wage_float_txns_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_float_txns" ADD CONSTRAINT "wage_float_txns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_floats" ADD CONSTRAINT "wage_floats_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wage_floats" ADD CONSTRAINT "wage_floats_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wage_float_txns_accrual_uniq" ON "wage_float_txns" USING btree ("source_table","source_id") WHERE kind = 'accrual';--> statement-breakpoint
CREATE INDEX "wage_float_txns_float_idx" ON "wage_float_txns" USING btree ("float_id","occurred_at");--> statement-breakpoint
CREATE INDEX "wage_float_txns_org_date_idx" ON "wage_float_txns" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wage_floats_emp_uniq" ON "wage_floats" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "pay_rate_history_emp_idx" ON "pay_rate_history" USING btree ("employee_id","kind","effective_from");