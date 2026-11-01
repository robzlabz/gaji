-- Jenis periode payroll: gaji reguler, slip THR, atau slip pesangon (issue #79).
-- Slip THR/pesangon disimpan sebagai periode payroll sekali bayar, jadi tanggal mulai
-- yang sama boleh dipakai jenis yang berbeda — indeks unik ikut memuat `kind`.
ALTER TABLE "pay_periods" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
DROP INDEX "pay_periods_org_start_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "pay_periods_org_start_kind_uniq" ON "pay_periods" USING btree ("org_id","period_start","kind");--> statement-breakpoint
CREATE INDEX "pay_periods_org_kind_idx" ON "pay_periods" USING btree ("org_id","kind","period_start");
