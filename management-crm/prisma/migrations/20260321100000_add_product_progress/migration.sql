-- 상품 처리 현황 필드 추가
ALTER TABLE "upsell_products" ADD COLUMN "powerlink_done" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "upsell_products" ADD COLUMN "channel_done" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "upsell_products" ADD COLUMN "receipt_review_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "upsell_products" ADD COLUMN "kakao_review_count" INTEGER NOT NULL DEFAULT 0;
