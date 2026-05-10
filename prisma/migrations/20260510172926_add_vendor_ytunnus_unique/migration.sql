/*
  Warnings:

  - A unique constraint covering the columns `[yTunnus]` on the table `Vendor` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Vendor_yTunnus_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_yTunnus_key" ON "Vendor"("yTunnus");
