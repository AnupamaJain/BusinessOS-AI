-- ============================================================================
-- BusinessOS AI - Travel Vertical Schema Migration
-- Tenant-bound tables for Travel & Tourism (Packages, Bookings, Flights, Hotels, Itineraries, Quotes)
-- ============================================================================

-- 1. destinations
CREATE TABLE destinations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) <= 255),
  country TEXT NOT NULL CHECK (char_length(country) <= 100),
  region TEXT CHECK (char_length(region) <= 100),
  description TEXT,
  best_season TEXT CHECK (char_length(best_season) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_destinations_org ON destinations(organization_id);

-- 2. packages (Holiday Packages)
CREATE TABLE packages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  destination_id UUID REFERENCES destinations(id) ON DELETE SET NULL,
  sku TEXT NOT NULL CHECK (char_length(sku) <= 100),
  title TEXT NOT NULL CHECK (char_length(title) <= 255),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price_per_person NUMERIC(12, 2) NOT NULL CHECK (price_per_person >= 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (char_length(currency) <= 10),
  inclusions JSONB DEFAULT '[]',
  highlights JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku)
);
CREATE INDEX idx_packages_org ON packages(organization_id);

-- 3. hotels
CREATE TABLE hotels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  destination_id UUID REFERENCES destinations(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (char_length(name) <= 255),
  star_rating INTEGER CHECK (star_rating BETWEEN 1 AND 5),
  address TEXT,
  amenities JSONB DEFAULT '[]',
  nightly_rate NUMERIC(12, 2) NOT NULL CHECK (nightly_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_hotels_org ON hotels(organization_id);

-- 4. flights
CREATE TABLE flights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  airline TEXT NOT NULL CHECK (char_length(airline) <= 100),
  flight_number TEXT NOT NULL CHECK (char_length(flight_number) <= 50),
  origin TEXT NOT NULL CHECK (char_length(origin) <= 10),
  destination TEXT NOT NULL CHECK (char_length(destination) <= 10),
  departure_time TIMESTAMPTZ NOT NULL,
  arrival_time TIMESTAMPTZ NOT NULL,
  fare_amount NUMERIC(12, 2) NOT NULL CHECK (fare_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_flights_org ON flights(organization_id);

-- 5. bookings
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  package_id UUID REFERENCES packages(id),
  booking_number TEXT NOT NULL CHECK (char_length(booking_number) <= 100),
  travel_date TIMESTAMPTZ NOT NULL,
  traveler_count INTEGER NOT NULL DEFAULT 1 CHECK (traveler_count > 0),
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (char_length(currency) <= 10),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, booking_number)
);
CREATE INDEX idx_bookings_org ON bookings(organization_id);
CREATE INDEX idx_bookings_contact ON bookings(contact_id);

-- 6. quotes (Price Quotes / Itinerary Estimates)
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  package_id UUID REFERENCES packages(id),
  quote_number TEXT NOT NULL CHECK (char_length(quote_number) <= 100),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  valid_until TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'expired', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotes_org ON quotes(organization_id);

-- 7. itineraries
CREATE TABLE itineraries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(title) <= 255),
  day_by_day JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_itineraries_org ON itineraries(organization_id);

-- Apply RLS to all travel tables
ALTER TABLE destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE itineraries ENABLE ROW LEVEL SECURITY;

-- Apply standard org membership policy helper
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'destinations', 'packages', 'hotels', 'flights',
    'bookings', 'quotes', 'itineraries'
  ]
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (public.is_member_of(organization_id))', tbl || '_select', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (public.is_member_of(organization_id))', tbl || '_insert', tbl);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (public.is_member_of(organization_id))', tbl || '_update', tbl);
  END LOOP;
END;
$$;
