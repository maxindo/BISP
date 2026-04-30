-- Migration: Create voucher_revenue table for separating vouchers from PPPoE users
-- Date: 2025-11-05
-- Critical: This table is required to distinguish hotspot vouchers from PPPoE users

CREATE TABLE IF NOT EXISTS voucher_revenue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    profile TEXT,
    status TEXT DEFAULT 'unpaid' CHECK(status IN ('unpaid', 'paid')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    usage_count INTEGER DEFAULT 0,
    notes TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_voucher_revenue_username ON voucher_revenue(username);
CREATE INDEX IF NOT EXISTS idx_voucher_revenue_status ON voucher_revenue(status);
CREATE INDEX IF NOT EXISTS idx_voucher_revenue_created_at ON voucher_revenue(created_at);

