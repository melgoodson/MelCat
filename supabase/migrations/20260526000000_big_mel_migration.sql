-- Migration: Create Big Mel Shopify Backend Tables
-- Tables: big_mel_entitlements, big_mel_chat_usage, big_mel_webhook_events

-- 1. Create big_mel_entitlements
CREATE TABLE IF NOT EXISTS public.big_mel_entitlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id TEXT,
    customer_email TEXT,
    shop_domain TEXT NOT NULL,
    variant_id TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create big_mel_chat_usage
CREATE TABLE IF NOT EXISTS public.big_mel_chat_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    shop_domain TEXT NOT NULL,
    chat_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_session_shop UNIQUE (session_id, shop_domain)
);

-- 3. Create big_mel_webhook_events
CREATE TABLE IF NOT EXISTS public.big_mel_webhook_events (
    id TEXT PRIMARY KEY, -- Shopify Webhook ID
    topic TEXT NOT NULL,
    shop_domain TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Create Performance & Lookup Indexes
CREATE INDEX IF NOT EXISTS idx_big_mel_entitlements_email ON public.big_mel_entitlements (customer_email);
CREATE INDEX IF NOT EXISTS idx_big_mel_entitlements_cust_id ON public.big_mel_entitlements (customer_id);
CREATE INDEX IF NOT EXISTS idx_big_mel_entitlements_shop ON public.big_mel_entitlements (shop_domain);
CREATE INDEX IF NOT EXISTS idx_big_mel_chat_usage_session_shop ON public.big_mel_chat_usage (session_id, shop_domain);
