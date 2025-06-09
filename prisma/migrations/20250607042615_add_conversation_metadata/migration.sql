
ALTER TABLE "Conversation"
ADD COLUMN     "sendFirst" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "templateName" TEXT;

