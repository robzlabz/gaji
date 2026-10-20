ALTER TABLE "time_entries" ADD COLUMN "deleted_at" timestamp with time zone;
DROP INDEX "time_entries_one_open";
CREATE UNIQUE INDEX "time_entries_one_open" ON "time_entries" USING btree ("employee_id") WHERE clock_out_at is null and deleted_at is null;
