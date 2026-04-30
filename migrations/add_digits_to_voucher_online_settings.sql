-- Migration: Add digits column to voucher_online_settings table
-- Date: 2025-10-13
-- Description: Add digits column to store voucher digit count in voucher_online_settings table

-- Add digits column to voucher_online_settings table
ALTER TABLE voucher_online_settings ADD COLUMN digits INTEGER NOT NULL DEFAULT 5;

-- Update existing records with default digit count
UPDATE voucher_online_settings 
SET digits = 5;

-- Create index for faster queries on digits column
CREATE INDEX IF NOT EXISTS idx_voucher_online_settings_digits ON voucher_online_settings(digits);