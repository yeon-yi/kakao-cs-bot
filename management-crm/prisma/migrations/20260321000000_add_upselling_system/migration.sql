-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('receipt_only', 'kakao_only', 'both');
CREATE TYPE "ChannelType" AS ENUM ('none', 'kakao_channel', 'blog_skin');

-- AlterEnum (Role에 업셀링 역할 추가)
ALTER TYPE "Role" ADD VALUE 'upselling_director';
ALTER TYPE "Role" ADD VALUE 'upselling_chief';
ALTER TYPE "Role" ADD VALUE 'upselling_staff';

-- AlterTable: User에 createdById 추가
ALTER TABLE "users" ADD COLUMN "created_by_id" INTEGER;
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Company에 cardCompany, paymentAmount 추가
ALTER TABLE "companies" ADD COLUMN "card_company" TEXT;
ALTER TABLE "companies" ADD COLUMN "payment_amount" INTEGER;

-- CreateTable: UpsellAssignment
CREATE TABLE "upsell_assignments" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "assigned_to_id" INTEGER NOT NULL,
    "assigned_by_id" INTEGER NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "upsell_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "upsell_assignments_company_id_assigned_to_id_key" ON "upsell_assignments"("company_id", "assigned_to_id");
CREATE INDEX "upsell_assignments_assigned_to_id_idx" ON "upsell_assignments"("assigned_to_id");
CREATE INDEX "upsell_assignments_assigned_by_id_idx" ON "upsell_assignments"("assigned_by_id");
CREATE INDEX "upsell_assignments_assigned_at_idx" ON "upsell_assignments"("assigned_at");

ALTER TABLE "upsell_assignments" ADD CONSTRAINT "upsell_assignments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upsell_assignments" ADD CONSTRAINT "upsell_assignments_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upsell_assignments" ADD CONSTRAINT "upsell_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: UpsellProduct
CREATE TABLE "upsell_products" (
    "id" SERIAL NOT NULL,
    "assignment_id" INTEGER NOT NULL,
    "has_powerlink" BOOLEAN NOT NULL DEFAULT false,
    "powerlink_ad_id" TEXT,
    "powerlink_ad_password" TEXT,
    "review_type" "ReviewType" NOT NULL DEFAULT 'both',
    "receipt_review_target" INTEGER NOT NULL DEFAULT 75,
    "kakao_review_target" INTEGER NOT NULL DEFAULT 75,
    "total_review_target" INTEGER NOT NULL DEFAULT 150,
    "channel_type" "ChannelType" NOT NULL DEFAULT 'none',
    "naver_account" TEXT,
    "upsell_amount" INTEGER,
    "kakao_map_url" TEXT,
    "kakao_map_place_id" TEXT,
    "kakao_map_name" TEXT,
    "initial_review_count" INTEGER NOT NULL DEFAULT 0,
    "exposure_count" INTEGER NOT NULL DEFAULT 0,
    "contract_start" TIMESTAMP(3),
    "contract_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "upsell_products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "upsell_products_assignment_id_key" ON "upsell_products"("assignment_id");

ALTER TABLE "upsell_products" ADD CONSTRAINT "upsell_products_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "upsell_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: KakaoMapReview
CREATE TABLE "kakao_map_reviews" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "author" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "rating" INTEGER NOT NULL DEFAULT 0,
    "is_ours" BOOLEAN NOT NULL DEFAULT false,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" INTEGER,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kakao_map_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kakao_map_reviews_product_id_idx" ON "kakao_map_reviews"("product_id");

ALTER TABLE "kakao_map_reviews" ADD CONSTRAINT "kakao_map_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "upsell_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kakao_map_reviews" ADD CONSTRAINT "kakao_map_reviews_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: UpsellLog
CREATE TABLE "upsell_logs" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER,
    "user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "upsell_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "upsell_logs_user_id_idx" ON "upsell_logs"("user_id");
CREATE INDEX "upsell_logs_created_at_idx" ON "upsell_logs"("created_at");

ALTER TABLE "upsell_logs" ADD CONSTRAINT "upsell_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
