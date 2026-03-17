-- CreateTable
CREATE TABLE "DiscordPdfJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "inputZip" BLOB NOT NULL,
    "resultZip" BLOB,
    "provider" TEXT,
    "workerId" TEXT,
    "errorMessage" TEXT,
    "claimedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "DiscordPdfJob_status_createdAt_idx" ON "DiscordPdfJob"("status", "createdAt");
