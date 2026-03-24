-- 업셀 결제 관리 필드 추가
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "payment_status" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "payment_card_type" TEXT;
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "payment_card_company" TEXT;
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "payment_cash_amount" INTEGER;
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "payment_card_amount" INTEGER;
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "has_tax_invoice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "payment_note" TEXT;
ALTER TABLE "upsell_products" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);
