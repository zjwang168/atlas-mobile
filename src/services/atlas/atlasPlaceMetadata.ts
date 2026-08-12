export type AtlasTransportMode = 'walk' | 'bike' | 'drive' | 'taxi' | 'bus' | 'coach' | 'subway' | 'train' | 'ferry' | 'flight';

const METADATA_PREFIX = '__atlas_metadata__:';
const TRANSPORT_MODES = new Set<AtlasTransportMode>([
  'walk', 'bike', 'drive', 'taxi', 'bus', 'coach', 'subway', 'train', 'ferry', 'flight',
]);

export function decodeAtlasPlaceMetadata(value?: string | null): { note: string | null; transport: AtlasTransportMode | null } {
  if (!value?.startsWith(METADATA_PREFIX)) return { note: value ?? null, transport: null };
  try {
    const parsed = JSON.parse(value.slice(METADATA_PREFIX.length)) as { note?: unknown; transport?: unknown };
    return {
      note: typeof parsed.note === 'string' && parsed.note ? parsed.note : null,
      transport: typeof parsed.transport === 'string' && TRANSPORT_MODES.has(parsed.transport as AtlasTransportMode)
        ? parsed.transport as AtlasTransportMode
        : null,
    };
  } catch {
    return { note: value, transport: null };
  }
}

export function encodeAtlasPlaceMetadata(note?: string | null, transport?: AtlasTransportMode | null): string | null {
  const cleanNote = note?.trim() || null;
  if (!transport) return cleanNote;
  return `${METADATA_PREFIX}${JSON.stringify({ note: cleanNote, transport })}`;
}
