/** Row shape of the Supabase `atlas` table (renamed from `collections`). */
export type Atlas = {
  id: string;
  owner_id: string | null;
  title: string;
  emoji: string;
  description: string | null;
  visibility: string;
  created_at: string;
  updated_at: string;
};
