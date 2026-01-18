import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase env vars");
}

export const storageBucket = import.meta.env.VITE_SUPABASE_BUCKET as string | undefined;

if (!storageBucket) {
  throw new Error("Missing VITE_SUPABASE_BUCKET");
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});
