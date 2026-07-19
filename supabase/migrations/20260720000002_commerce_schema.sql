-- ============================================================================
-- BusinessOS AI - Commerce & Payments Schema Migration
-- Tenant-bound tables for Products, Product Variants, Orders, Order Items, Payments, Invoices, Refunds
-- ============================================================================

-- 1. products
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku TEXT NOT NULL CHECK (char_length(sku) <= 100),
  name TEXT NOT NULL CHECK (char_length(name) <= 255),
  description TEXT,
  category TEXT CHECK (char_length(category) <= 100),
  base_price NUMERIC(12, 2) NOT NULL CHECK (base_price >= 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (char_length(currency) <= 10),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku)
);
CREATE INDEX idx_products_org ON products(organization_id);

-- 2. product_variants
CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL CHECK (char_length(sku) <= 100),
  variant_name TEXT NOT NULL CHECK (char_length(variant_name) <= 100),
  price NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_variants_org ON product_variants(organization_id);

-- 3. orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL CHECK (char_length(order_number) <= 100),
  subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (char_length(currency) <= 10),
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, order_number)
);
CREATE INDEX idx_orders_org ON orders(organization_id);
CREATE INDEX idx_orders_contact ON orders(contact_id);

-- 4. order_items
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) <= 255),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_price NUMERIC(12, 2) NOT NULL CHECK (total_price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_items_org ON order_items(organization_id);

-- 5. payments
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_number TEXT NOT NULL CHECK (char_length(payment_number) <= 100),
  provider TEXT NOT NULL CHECK (provider IN ('razorpay', 'stripe', 'upi', 'cash')),
  provider_transaction_id TEXT,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (char_length(currency) <= 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'refunded')),
  payment_link_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_org ON payments(organization_id);

-- 6. invoices
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL CHECK (char_length(invoice_number) <= 100),
  amount_due NUMERIC(12, 2) NOT NULL CHECK (amount_due >= 0),
  amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  due_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'void')),
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, invoice_number)
);
CREATE INDEX idx_invoices_org ON invoices(organization_id);

-- 7. refunds
CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  refund_number TEXT NOT NULL CHECK (char_length(refund_number) <= 100),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refunds_org ON refunds(organization_id);

-- Enable RLS on all commerce tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- Apply standard org membership RLS policy helper
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'products', 'product_variants', 'orders', 'order_items',
    'payments', 'invoices', 'refunds'
  ]
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (public.is_member_of(organization_id))', tbl || '_select', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (public.is_member_of(organization_id))', tbl || '_insert', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (public.is_member_of(organization_id))', tbl || '_update', tbl);
  END LOOP;
END;
$$;
