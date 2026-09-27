/** Server-only database access for Déjà Dev routes. */
export async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type MemoryRow = {
  id: string;
  user_id: string;
  text: string;
  namespace: string;
  source: string;
  memory_id: string | null;
  blob_id: string | null;
  job_id: string | null;
  status: string;
  superseded_by: string | null;
  created_at: string;
};
