-- Trigram search on product names (search and matching tickets).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "RetailerType" AS ENUM ('SUPERMARKET', 'ONLINE');

-- CreateEnum
CREATE TYPE "UnitKind" AS ENUM ('G', 'ML', 'PIECE');

-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('PRICE_CUT', 'X_PLUS_Y_FREE', 'NTH_HALF_PRICE', 'X_FOR_PRICE', 'PERCENT_OFF', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('SAME', 'SIMILAR', 'ALTERNATIVE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('AUTO', 'NEEDS_REVIEW', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('WRONG_MATCH', 'WRONG_PRICE', 'OTHER');

-- CreateTable
CREATE TABLE "retailers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "RetailerType" NOT NULL DEFAULT 'SUPERMARKET',
    "country" TEXT NOT NULL DEFAULT 'NL',
    "website" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "adapterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retailers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "openingHours" JSONB,
    "deliveryAvailable" BOOLEAN NOT NULL DEFAULT false,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nameNl" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameIt" TEXT NOT NULL,
    "parentId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "brand" TEXT,
    "categoryId" TEXT,
    "ean" TEXT,
    "imageUrl" TEXT,
    "unit" "UnitKind",
    "packageAmount" INTEGER,
    "packageCount" INTEGER NOT NULL DEFAULT 1,
    "isOrganic" BOOLEAN NOT NULL DEFAULT false,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "storeId" TEXT,
    "title" TEXT NOT NULL,
    "currentPriceCents" INTEGER,
    "regularPriceCents" INTEGER,
    "promoType" "PromoType" NOT NULL DEFAULT 'PRICE_CUT',
    "promoParams" JSONB NOT NULL DEFAULT '{}',
    "promoDescription" TEXT,
    "pricePerUnitCents" INTEGER,
    "validFrom" DATE,
    "validUntil" DATE,
    "validityApproximate" BOOLEAN NOT NULL DEFAULT false,
    "conditions" TEXT,
    "availableOnline" BOOLEAN NOT NULL DEFAULT false,
    "availableInStore" BOOLEAN NOT NULL DEFAULT true,
    "status" "OfferStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceUrl" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "retailerId" TEXT NOT NULL,
    "storeId" TEXT,
    "priceCents" INTEGER NOT NULL,
    "regularPriceCents" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_matches" (
    "id" TEXT NOT NULL,
    "canonicalProductId" TEXT NOT NULL,
    "candidateProductId" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" TEXT NOT NULL,
    "retailerId" TEXT,
    "adapter" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "IngestionStatus" NOT NULL DEFAULT 'RUNNING',
    "itemsFound" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_lists" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_list_items" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "pinnedRetailerId" TEXT,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopping_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "productId" TEXT,
    "offerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "productId" TEXT,
    "productMatchId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retailers_slug_key" ON "retailers"("slug");

-- CreateIndex
CREATE INDEX "stores_retailerId_idx" ON "stores"("retailerId");

-- CreateIndex
CREATE UNIQUE INDEX "stores_retailerId_sourceRef_key" ON "stores"("retailerId", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "products_ean_idx" ON "products"("ean");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "products"("brand");

-- CreateIndex
CREATE INDEX "products_normalized_name_trgm_idx" ON "products" USING GIN ("normalizedName" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "products_retailerId_externalId_key" ON "products"("retailerId", "externalId");

-- CreateIndex
CREATE INDEX "offers_productId_idx" ON "offers"("productId");

-- CreateIndex
CREATE INDEX "offers_retailerId_validUntil_idx" ON "offers"("retailerId", "validUntil");

-- CreateIndex
CREATE INDEX "offers_validFrom_validUntil_idx" ON "offers"("validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "offers_status_idx" ON "offers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "offers_retailerId_contentHash_key" ON "offers"("retailerId", "contentHash");

-- CreateIndex
CREATE INDEX "price_history_productId_recordedAt_idx" ON "price_history"("productId", "recordedAt");

-- CreateIndex
CREATE INDEX "product_matches_candidateProductId_idx" ON "product_matches"("candidateProductId");

-- CreateIndex
CREATE INDEX "product_matches_status_idx" ON "product_matches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "product_matches_canonicalProductId_candidateProductId_key" ON "product_matches"("canonicalProductId", "candidateProductId");

-- CreateIndex
CREATE INDEX "ingestion_runs_adapter_startedAt_idx" ON "ingestion_runs"("adapter", "startedAt");

-- CreateIndex
CREATE INDEX "shopping_lists_deviceId_idx" ON "shopping_lists"("deviceId");

-- CreateIndex
CREATE INDEX "shopping_list_items_listId_position_idx" ON "shopping_list_items"("listId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_deviceId_productId_key" ON "favorites"("deviceId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_deviceId_offerId_key" ON "favorites"("deviceId", "offerId");

-- CreateIndex
CREATE INDEX "feedback_kind_createdAt_idx" ON "feedback"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "retailers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "retailers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "retailers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "retailers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_matches" ADD CONSTRAINT "product_matches_candidateProductId_fkey" FOREIGN KEY ("candidateProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_retailerId_fkey" FOREIGN KEY ("retailerId") REFERENCES "retailers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_listId_fkey" FOREIGN KEY ("listId") REFERENCES "shopping_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_pinnedRetailerId_fkey" FOREIGN KEY ("pinnedRetailerId") REFERENCES "retailers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_productMatchId_fkey" FOREIGN KEY ("productMatchId") REFERENCES "product_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rules Prisma cannot express. An unknown value is NULL, never a guessed number.
ALTER TABLE "offers"
  ADD CONSTRAINT "offers_current_price_non_negative" CHECK ("currentPriceCents" IS NULL OR "currentPriceCents" >= 0),
  ADD CONSTRAINT "offers_regular_price_non_negative" CHECK ("regularPriceCents" IS NULL OR "regularPriceCents" >= 0),
  ADD CONSTRAINT "offers_unit_price_non_negative" CHECK ("pricePerUnitCents" IS NULL OR "pricePerUnitCents" >= 0),
  ADD CONSTRAINT "offers_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  ADD CONSTRAINT "offers_validity_order" CHECK ("validFrom" IS NULL OR "validUntil" IS NULL OR "validFrom" <= "validUntil"),
  -- An offer without a known end date can never be shown as verified.
  ADD CONSTRAINT "offers_verified_needs_validity" CHECK ("status" <> 'VERIFIED' OR "validUntil" IS NOT NULL);

ALTER TABLE "products"
  ADD CONSTRAINT "products_package_amount_positive" CHECK ("packageAmount" IS NULL OR "packageAmount" > 0),
  ADD CONSTRAINT "products_package_count_positive" CHECK ("packageCount" > 0),
  ADD CONSTRAINT "products_unit_with_amount" CHECK (("unit" IS NULL) = ("packageAmount" IS NULL));

ALTER TABLE "price_history"
  ADD CONSTRAINT "price_history_price_non_negative" CHECK ("priceCents" >= 0);

ALTER TABLE "product_matches"
  ADD CONSTRAINT "product_matches_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  ADD CONSTRAINT "product_matches_distinct_products" CHECK ("canonicalProductId" <> "candidateProductId");

ALTER TABLE "shopping_list_items"
  ADD CONSTRAINT "shopping_list_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "favorites"
  ADD CONSTRAINT "favorites_exactly_one_target" CHECK (("productId" IS NULL) <> ("offerId" IS NULL));
