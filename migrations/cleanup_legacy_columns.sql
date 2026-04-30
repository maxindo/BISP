-- Migration: Cleanup Legacy Columns
-- Date: 2025-01-27
-- Description: Remove legacy columns and improve data integrity

-- 1. Backup existing data before cleanup
-- Note: Kolom 'amount' di collector_payments adalah duplikat dari payment_amount
-- Sebelum menghapus, pastikan tidak ada data yang berbeda

-- 2. Check for data inconsistencies
-- Query untuk mengecek apakah ada perbedaan antara amount dan payment_amount
SELECT 
    id, 
    amount, 
    payment_amount,
    (amount - payment_amount) as difference
FROM collector_payments 
WHERE amount != payment_amount;

-- 3. Update any inconsistent data (amount should equal payment_amount)
UPDATE collector_payments 
SET amount = payment_amount 
WHERE amount != payment_amount;

-- 4. Remove legacy amount column (uncomment when ready)
-- ALTER TABLE collector_payments DROP COLUMN amount;

-- 5. Add constraints for better data integrity
-- Ensure commission_rate is within valid range
ALTER TABLE collectors ADD CONSTRAINT chk_commission_rate 
CHECK (commission_rate >= 0 AND commission_rate <= 100);

-- Ensure payment_amount is positive
ALTER TABLE collector_payments ADD CONSTRAINT chk_payment_amount 
CHECK (payment_amount > 0);

-- Ensure commission_amount is non-negative
ALTER TABLE collector_payments ADD CONSTRAINT chk_commission_amount 
CHECK (commission_amount >= 0);

-- 6. Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_collector_payments_collector_id ON collector_payments(collector_id);
CREATE INDEX IF NOT EXISTS idx_collector_payments_customer_id ON collector_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_collector_payments_payment_date ON collector_payments(collected_at);

-- 7. Update invoice amount constraints
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_amount 
CHECK (amount > 0);

ALTER TABLE invoices ADD CONSTRAINT chk_base_amount 
CHECK (base_amount > 0);

ALTER TABLE invoices ADD CONSTRAINT chk_tax_rate 
CHECK (tax_rate >= 0 AND tax_rate <= 100);
