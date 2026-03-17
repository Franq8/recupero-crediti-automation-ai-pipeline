-- CreateTable
CREATE TABLE "DiscordAutocontinueJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "namingPattern" TEXT,
    "openclawRowFlowResultsJson" TEXT,
    "templateFilename" TEXT NOT NULL,
    "templateMimeType" TEXT NOT NULL,
    "templateBytes" BLOB NOT NULL,
    "tableFilename" TEXT NOT NULL,
    "tableMimeType" TEXT NOT NULL,
    "tableBytes" BLOB NOT NULL,
    "practiceId" TEXT,
    "finalSummaryJson" TEXT,
    "downloadUrl" TEXT,
    "downloadExpiresAt" DATETIME,
    "downloadMaxDownloads" INTEGER,
    "downloadRetainedUntil" DATETIME,
    "errorMessage" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "DiscordAutocontinueJob_status_createdAt_idx" ON "DiscordAutocontinueJob"("status", "createdAt");
CREATE INDEX "DiscordAutocontinueJob_practiceId_idx" ON "DiscordAutocontinueJob"("practiceId");
