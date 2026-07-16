const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const CHAT_SOURCE_TYPES = new Set([
  'smart_text',
  'image_scan',
  'find_image_places',
  'reddit_links',
  'youtube_links',
  'any_links',
]);

function normalizeChatSourceType(value) {
  if (!value) return null;
  return CHAT_SOURCE_TYPES.has(value) ? value : null;
}

function inferChatSourceType({ sourceUrl = '', title = '', sourceType = '' }) {
  const explicit = normalizeChatSourceType(sourceType);
  if (explicit) return explicit;

  const haystack = `${sourceUrl} ${title}`.toLowerCase();

  if (title.toLowerCase().includes('atlas ai chat')) return 'smart_text';
  if (title.toLowerCase().includes('youtube')) return 'youtube_links';
  if (title.toLowerCase().includes('reddit')) return 'reddit_links';
  if (haystack.includes('find_image_places') || haystack.includes('find image place') || haystack.includes('photo')) {
    return 'find_image_places';
  }
  if (haystack.includes('image_scan') || haystack.includes('scan image') || haystack.includes('scan_images')) {
    return 'image_scan';
  }
  if (haystack.includes('youtube.com') || haystack.includes('youtu.be') || haystack.includes('youtube')) {
    return 'youtube_links';
  }
  if (haystack.includes('reddit.com') || haystack.includes('reddit')) {
    return 'reddit_links';
  }
  if (haystack.includes('http://') || haystack.includes('https://') || haystack.includes('www.')) {
    return 'any_links';
  }
  return 'smart_text';
}

async function main() {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, source_url, source_type')
    .order('updated_at', { ascending: false });

  if (error) throw error;

  const rows = data || [];
  let changed = 0;

  for (const row of rows) {
    const nextType = inferChatSourceType({
      title: row.title || '',
      sourceUrl: row.source_url || '',
      sourceType: row.source_type || '',
    });

    if (row.source_type === nextType) continue;

    const { error: updateError } = await supabase
      .from('conversations')
      .update({ source_type: nextType })
      .eq('id', row.id);

    if (updateError) {
      console.error(`Failed to update ${row.id}:`, updateError.message || updateError);
      continue;
    }

    changed += 1;
    console.log(`${row.id}: ${row.source_type || 'null'} -> ${nextType}`);
  }

  console.log(`Done. Updated ${changed} conversation(s) out of ${rows.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
