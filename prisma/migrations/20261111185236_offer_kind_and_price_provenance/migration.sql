-- CreateEnum
CREATE TYPE "OfferKind" AS ENUM ('WEEKLY', 'DAILY');

-- AlterTable
ALTER TABLE "feedback" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "kind" "OfferKind" NOT NULL DEFAULT 'WEEKLY';

-- AlterTable
ALTER TABLE "price_history" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceUrl" TEXT;
