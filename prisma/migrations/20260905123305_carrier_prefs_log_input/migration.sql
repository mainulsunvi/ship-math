-- AlterTable
ALTER TABLE "RequestLog" ADD COLUMN "input" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "carrierServiceId" TEXT;
ALTER TABLE "Shop" ADD COLUMN "prefs" TEXT;

-- CreateIndex
CREATE INDEX "RequestLog_shopId_source_createdAt_idx" ON "RequestLog"("shopId", "source", "createdAt");
