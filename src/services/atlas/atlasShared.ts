/** Shared between `atlasService.ts` and `../local/syncQueue.ts` — kept in its
    own module so neither has to import the other (they already both import
    from `../local/syncQueue.ts` / feed into it, which would otherwise cycle). */

export const ATLAS_SELECT_COLUMNS = 'id, owner_id, title, emoji, description, visibility, created_at, updated_at';

const MAX_ATLAS_TITLE_LENGTH = 255;

export function truncateAtlasTitle(title: string): string {
  return title.length > MAX_ATLAS_TITLE_LENGTH ? title.slice(0, MAX_ATLAS_TITLE_LENGTH) : title;
}
