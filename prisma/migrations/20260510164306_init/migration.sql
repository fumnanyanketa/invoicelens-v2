-- CreateTable
CREATE TABLE "Vendor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "nameVariants" TEXT NOT NULL DEFAULT '[]',
    "yTunnus" TEXT,
    "country" TEXT NOT NULL DEFAULT 'FI',
    "expectedGlCategory" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "originalFilename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "vendorName" TEXT,
    "vendorEmail" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" DATETIME,
    "dueDate" DATETIME,
    "grossAmount" REAL,
    "vatAmount" REAL,
    "vatRate" REAL,
    "vatCode" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "lineItems" TEXT NOT NULL DEFAULT '[]',
    "glCodeSuggestion" TEXT,
    "glReasoning" TEXT,
    "extractionCompleteness" REAL,
    "vendorMatchScore" REAL,
    "duplicateSignal" REAL,
    "sanctionsSignal" REAL,
    "confidenceScore" REAL,
    "lane" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedAt" DATETIME,
    "vendorId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'heikki',
    "aiRecommendation" TEXT,
    "humanDecision" TEXT,
    "reasoning" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Vendor_name_idx" ON "Vendor"("name");

-- CreateIndex
CREATE INDEX "Vendor_yTunnus_idx" ON "Vendor"("yTunnus");

-- CreateIndex
CREATE INDEX "Invoice_invoiceNumber_idx" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_vendorName_idx" ON "Invoice"("vendorName");

-- CreateIndex
CREATE INDEX "Invoice_lane_idx" ON "Invoice"("lane");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_invoiceId_idx" ON "AuditLog"("invoiceId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
