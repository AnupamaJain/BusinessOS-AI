-- Early-access waitlist — public insert, no public read.
CREATE TABLE waitlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  business_type TEXT CHECK (char_length(business_type) <= 100),
  source TEXT DEFAULT 'landing' CHECK (char_length(source) <= 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_waitlist_created ON waitlist(created_at);
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
-- Anyone (anon) may join the waitlist; nobody can read it back via the anon key.
CREATE POLICY waitlist_public_insert ON waitlist FOR INSERT WITH CHECK (true);
