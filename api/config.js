// Hands the browser the public Supabase settings.
// Vercel Environment Variables override the defaults below (either naming style works).
// The publishable key is meant to be public; access is controlled by the RLS policies in supabase/schema.sql.
const DEFAULT_URL = 'https://lttlyffbyomlhvzslscl.supabase.co';
const DEFAULT_KEY = 'sb_publishable_NcR3NZZRdc-peoCug4sX8A_oTiwq3E4';

module.exports = (req, res) => {
  const env = process.env;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    url: env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_URL,
    anonKey: env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || DEFAULT_KEY,
  }));
};
