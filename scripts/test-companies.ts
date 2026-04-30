import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data, count, error } = await supabase.from('companies').select('*', { count: 'exact' });
  if (error) console.error(error);
  console.log('Total em DB:', count);
  console.log('Retornados:', data?.length);
}

check();
