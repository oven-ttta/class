// Hands the browser the public Supabase settings from Vercel environment variables.
// The anon key is meant to be public; access is controlled by the RLS policies in supabase/schema.sql.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  }));
};
