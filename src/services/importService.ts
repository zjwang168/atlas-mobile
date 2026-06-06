import { supabase } from './supabaseClient';

export type ExtractedPlaceInput = {
  name: string;
  subtitle?: string;
  type?: string;
  city?: string;
  country?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  ai_summary?: string;
  confidence?: number;
};

export async function createImportWithExtractedPlaces(params: {
  inputType: 'text' | 'link' | 'image';
  inputText?: string;
  inputUrl?: string;
  places: ExtractedPlaceInput[];
}) {
  const { inputType, inputText, inputUrl, places } = params;

  const { data: importRecord, error: importError } = await supabase
    .from('imports')
    .insert({
      input_type: inputType,
      input_text: inputText ?? null,
      input_url: inputUrl ?? null,
      status: 'completed',
    })
    .select()
    .single();

  if (importError) throw importError;

  const extractedRows = places.map((place) => ({
    import_id: importRecord.id,
    name: place.name,
    address: place.address ?? null,
    city: place.city ?? null,
    country: place.country ?? null,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    ai_summary: place.ai_summary ?? null,
    confidence: place.confidence ?? 0.8,
    status: 'pending',
  }));

  const { data: extractedPlaces, error: extractedError } = await supabase
    .from('extracted_places')
    .insert(extractedRows)
    .select();

  if (extractedError) throw extractedError;

  return {
    importRecord,
    extractedPlaces,
  };
}