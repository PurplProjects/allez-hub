-- ============================================================
-- ALLEZ FENCING HUB — SUPABASE DATABASE SCHEMA
-- Run this in Supabase SQL Editor (in order)
-- ============================================================

-- ── 1. USERS ────────────────────────────────────────────────
-- One row per club member (parent, fencer, or coach)
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  role        TEXT NOT NULL DEFAULT 'fencer',   -- 'fencer' | 'parent' | 'coach'
  name        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_login  TIMESTAMPTZ
);

-- ── 2. OTP CODES ────────────────────────────────────────────
-- Temporary one-time passcodes (deleted after use)
CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,                    -- 6-digit code
  expires_at  TIMESTAMPTZ NOT NULL,             -- now() + 10 minutes
  used        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Auto-delete expired codes (run nightly via Supabase cron or pg_cron)
CREATE INDEX idx_otp_email ON otp_codes(email);
CREATE INDEX idx_otp_expires ON otp_codes(expires_at);

-- ── 3. FENCERS ──────────────────────────────────────────────
-- One row per fencer registered in the club
CREATE TABLE fencers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  first_name      TEXT,
  bf_licence      TEXT UNIQUE,                  -- British Fencing licence e.g. 157149
  ukr_id          TEXT UNIQUE,                  -- UKRatings internal ID e.g. 65339
  ukr_weapon_id   TEXT DEFAULT '34',            -- 34 = Foil, 35 = Epee, 36 = Sabre
  category        TEXT,                         -- e.g. U13
  dob_year        INT,                          -- year of birth only (no full DOB)
  club            TEXT DEFAULT 'Allez Fencing',
  school          TEXT,
  active          BOOLEAN DEFAULT true,
  colour          TEXT DEFAULT '#F97316',        -- avatar colour for dashboard
  cue_phrase      TEXT DEFAULT 'My footwork',   -- personal pre-bout cue phrase
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── 4. COMPETITIONS ─────────────────────────────────────────
-- One row per competition entered by a fencer
CREATE TABLE competitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fencer_id       UUID REFERENCES fencers(id) ON DELETE CASCADE,
  ukr_tourney_id  TEXT,                         -- UKRatings tourneydetail ID
  name            TEXT NOT NULL,                -- e.g. "Challenge Wratislavia 2026"
  event_name      TEXT,                         -- e.g. "U13 Boys Foil"
  date            DATE,
  venue           TEXT,
  rank            INT,
  field_size      INT,
  category        TEXT,
  weapon          TEXT DEFAULT 'Foil',
  source          TEXT DEFAULT 'ukratings',     -- 'ukratings' | 'manual' | 'engarde'
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_comp_fencer ON competitions(fencer_id);
CREATE INDEX idx_comp_date ON competitions(date DESC);

-- ── 5. BOUTS ────────────────────────────────────────────────
-- One row per bout (poule or DE)
CREATE TABLE bouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fencer_id       UUID REFERENCES fencers(id) ON DELETE CASCADE,
  competition_id  UUID REFERENCES competitions(id) ON DELETE CASCADE,
  date            DATE,
  opponent        TEXT NOT NULL,
  opponent_club   TEXT,
  score_for       INT NOT NULL,                 -- touches scored by our fencer
  score_against   INT NOT NULL,                 -- touches scored by opponent
  result          TEXT NOT NULL,                -- 'Won' | 'Lost'
  bout_type       TEXT NOT NULL,                -- 'Poule' | 'DE'
  de_round        TEXT,                         -- 'T64' | 'T32' | 'T16' etc (DE only)
  source          TEXT DEFAULT 'ukratings',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bout_fencer ON bouts(fencer_id);
CREATE INDEX idx_bout_comp   ON bouts(competition_id);
CREATE INDEX idx_bout_date   ON bouts(date DESC);
CREATE INDEX idx_bout_opp    ON bouts(opponent);

-- ── 6. SCRAPE LOG ───────────────────────────────────────────
-- Track when each fencer's data was last synced from UKRatings
CREATE TABLE scrape_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fencer_id   UUID REFERENCES fencers(id) ON DELETE CASCADE,
  scraped_at  TIMESTAMPTZ DEFAULT now(),
  status      TEXT DEFAULT 'success',           -- 'success' | 'error'
  bouts_added INT DEFAULT 0,
  error_msg   TEXT
);

-- ── 7. COACH NOTES ──────────────────────────────────────────
-- Free-text notes from Chris per fencer (private, coach-only)
CREATE TABLE coach_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fencer_id   UUID REFERENCES fencers(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  note        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── 8. CHECKLIST STATE ──────────────────────────────────────
-- Persists which mental checklist items a fencer has completed per competition day
CREATE TABLE checklist_state (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fencer_id     UUID REFERENCES fencers(id) ON DELETE CASCADE,
  checklist_date DATE NOT NULL,
  item_index    INT NOT NULL,                   -- 0-indexed
  completed     BOOLEAN DEFAULT true,
  completed_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(fencer_id, checklist_date, item_index)
);

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
-- Fencers can only read their own data
-- Coaches can read all data

ALTER TABLE fencers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bouts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_notes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_state ENABLE ROW LEVEL SECURITY;

-- Fencer policy: read own data only
CREATE POLICY fencer_own_data ON fencers
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'coach')
  );

CREATE POLICY bout_own_data ON bouts
  FOR SELECT USING (
    fencer_id IN (SELECT id FROM fencers WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'coach')
  );

CREATE POLICY comp_own_data ON competitions
  FOR SELECT USING (
    fencer_id IN (SELECT id FROM fencers WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'coach')
  );

-- Coach notes: coach read/write only
CREATE POLICY coach_notes_policy ON coach_notes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'coach')
  );

-- Checklist: fencer read/write own only
CREATE POLICY checklist_own ON checklist_state
  FOR ALL USING (
    fencer_id IN (SELECT id FROM fencers WHERE user_id = auth.uid())
  );

-- ── SAMPLE DATA ─────────────────────────────────────────────
-- Insert Allez Fencing coach account
INSERT INTO users (email, role, name) VALUES
  ('christian@allezfencing.com', 'coach', 'Christian Galesloot');

-- Insert Ajith as a fencer
INSERT INTO fencers (bf_licence, ukr_id, name, first_name, category, dob_year, school, colour, cue_phrase)
VALUES ('157149', '65339', 'Ajith Badhrinath', 'Ajith', 'U13', 2013, 'Brentwood School', '#F97316', 'My footwork');
