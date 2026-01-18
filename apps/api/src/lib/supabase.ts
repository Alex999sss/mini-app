import { createClient } from "@supabase/supabase-js";

import { config } from "../config";

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export const storageBucket = config.SUPABASE_STORAGE_BUCKET;
