-- CreateTable
CREATE TABLE "DiscordDownloadBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "practiceId" TEXT NOT NULL,
    "zipFilename" TEXT NOT NULL,
    "zipRelativePath" TEXT NOT NULL,
    "zipSha256" TEXT NOT NULL,
    "zipSizeBytes" INTEGER NOT NULL,
    "retainedUntil" DATETIME NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" DATETIME NOT NULL,
    "tokenMaxDownloads" INTEGER NOT NULL DEFAULT 3,
    "tokenDownloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "lastDownloadedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordDownloadBatch_practiceId_key" ON "DiscordDownloadBatch"("practiceId");

-- CreateIndex
CREATE INDEX "DiscordDownloadBatch_retainedUntil_idx" ON "DiscordDownloadBatch"("retainedUntil");

-- CreateIndex
CREATE INDEX "DiscordDownloadBatch_tokenHash_idx" ON "DiscordDownloadBatch"("tokenHash");
