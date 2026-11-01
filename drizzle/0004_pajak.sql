-- PPh 21 & BPJS (issue #78).
-- Catatan: perubahan `time_entries.deleted_at` (migrasi 0004_soft_delete_time_entries) ikut
-- terdeteksi saat generate karena snapshot Drizzle-nya belum pernah dibuat, padahal migrasi
-- itu sudah dikomit lebih dulu. Perintah ADD COLUMN/DROP INDEX untuk kolom tersebut sengaja
-- dibuang di sini supaya migrasi ini tetap aman dijalankan pada database yang sudah berjalan.

ALTER TABLE "employees" ADD COLUMN "ptkp_status" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "npwp" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bpjs_kesehatan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "bpjs_ketenagakerjaan" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "statutory_settings" jsonb;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "pph21" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "bpjs_employee" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "bpjs_employer" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "statutory" jsonb;
