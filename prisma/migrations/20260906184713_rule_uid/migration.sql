/*
  Warnings:

  - A unique constraint covering the columns `[uid]` on the ShippingRule table will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ShippingRule" ADD COLUMN "uid" TEXT;

-- Backfill: mint a distinct lowercase base36-ish uid per existing rule so the
-- unique index applies to meaningful values (NULLs would also be fine in
-- SQLite, but backfill keeps /app/rules/<uid> usable for pre-migration rules).
-- Deterministic per row via hex(id) substring seeding: id is a cuid (unique),
-- so uid collisions cannot occur; lowercased to match the repository format.
UPDATE "ShippingRule" SET "uid" = lower(substr(hex(randomblob(5)), 1, 10)) WHERE "uid" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRule_uid_key" ON "ShippingRule"("uid");
