-- Update voucher commission system to use nominal instead of percentage

-- Add new columns to voucher_online_settings
ALTER TABLE voucher_online_settings ADD COLUMN agent_price DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE voucher_online_settings ADD COLUMN commission_amount DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE voucher_online_settings ADD COLUMN is_active BOOLEAN DEFAULT 1;

-- Update existing records with default values
UPDATE voucher_online_settings 
SET agent_price = price * 0.8, 
    commission_amount = price * 0.2,
    is_active = 1
WHERE agent_price IS NULL;

-- Create table for voucher pricing management
CREATE TABLE IF NOT EXISTS voucher_pricing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id INTEGER NOT NULL,
    package_name TEXT NOT NULL,
    customer_price DECIMAL(10,2) NOT NULL,
    agent_price DECIMAL(10,2) NOT NULL,
    commission_amount DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (package_id) REFERENCES voucher_online_settings(id)
);

-- Insert default pricing data
INSERT INTO voucher_pricing (package_id, package_name, customer_price, agent_price, commission_amount, is_active)
SELECT 
    id,
    package_name,
    price as customer_price,
    price * 0.8 as agent_price,
    price * 0.2 as commission_amount,
    1 as is_active
FROM voucher_online_settings
WHERE status = 'active';

-- Update agent_voucher_sales to use new commission system
ALTER TABLE agent_voucher_sales ADD COLUMN agent_price DECIMAL(10,2) DEFAULT 0.00;
ALTER TABLE agent_voucher_sales ADD COLUMN commission_amount DECIMAL(10,2) DEFAULT 0.00;

-- Update existing records
UPDATE agent_voucher_sales 
SET agent_price = price * 0.8,
    commission_amount = price * 0.2
WHERE agent_price = 0.00;
