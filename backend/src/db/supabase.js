const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,   // Service role key — bypasses RLS for server-side ops
  {
    auth: { persistSession: false },
  }
);

module.exports = supabase;
