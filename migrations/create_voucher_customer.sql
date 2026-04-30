-- Migration: Create voucher public customer
-- Date: 2025-01-27
-- Description: Create a dedicated customer for voucher purchases to separate from regular billing

INSERT OR IGNORE INTO customers (
    id, username, name, phone, email, address, package_id, status, join_date, 
    pppoe_username, pppoe_profile, auto_suspension, billing_day, 
    latitude, longitude, created_by_technician_id, static_ip, mac_address, assigned_ip
) VALUES (
    1021, -- ID yang aman, jauh dari range billing (1000+)
    'voucher_public',
    'Voucher Publik',
    '0000000000',
    'voucher@public.com',
    'Sistem Voucher Publik',
    1,
    'active',
    datetime('now'),
    'voucher_public',
    'voucher',
    0,
    1,
    0,
    0,
    NULL,
    NULL,
    NULL,
    NULL
);
