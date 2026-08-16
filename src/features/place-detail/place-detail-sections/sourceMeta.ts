import type { Icon } from 'phosphor-react-native';
import { FacebookLogoIcon } from 'phosphor-react-native/src/icons/FacebookLogo';
import { GlobeIcon } from 'phosphor-react-native/src/icons/Globe';
import { ImageIcon } from 'phosphor-react-native/src/icons/Image';
import { InstagramLogoIcon } from 'phosphor-react-native/src/icons/InstagramLogo';
import { RedditLogoIcon } from 'phosphor-react-native/src/icons/RedditLogo';
import { SparkleIcon } from 'phosphor-react-native/src/icons/Sparkle';
import { TiktokLogoIcon } from 'phosphor-react-native/src/icons/TiktokLogo';
import { YoutubeLogoIcon } from 'phosphor-react-native/src/icons/YoutubeLogo';

export type SourceMeta = {
  label: string;
  Logo: Icon;
  /** Brand colour, used for the logo glyph and the card's tinted media block. */
  color: string;
};

/**
 * `place_sources.source_type` is our own controlled vocabulary — the backend
 * writes `youtube_links`, `instagram_reels`, `web_scrape` and so on (plus the
 * legacy `'link'` from before real types were recorded). Matching on a
 * substring is safe here precisely because the values aren't free text.
 */
const SOURCE_MATCHERS: [string, SourceMeta][] = [
  ['youtube', { label: 'YouTube', Logo: YoutubeLogoIcon, color: '#FF0000' }],
  ['tiktok', { label: 'TikTok', Logo: TiktokLogoIcon, color: '#25F4EE' }],
  ['instagram', { label: 'Instagram', Logo: InstagramLogoIcon, color: '#E1306C' }],
  ['facebook', { label: 'Facebook', Logo: FacebookLogoIcon, color: '#1877F2' }],
  ['reddit', { label: 'Reddit', Logo: RedditLogoIcon, color: '#FF4500' }],
  ['atlas_ai', { label: 'Atlas AI', Logo: SparkleIcon, color: '#12C170' }],
  ['image_scan', { label: 'Photo', Logo: ImageIcon, color: '#8E8E93' }],
];

const WEB: SourceMeta = { label: 'Web', Logo: GlobeIcon, color: '#0A84FF' };

/**
 * Resolve the platform badge for one source row. Anything that isn't a
 * recognised platform reads as a web link, labelled with its own hostname when
 * the URL has one — "eater.com" says more than a second generic "Web" chip
 * sitting next to the first.
 */
export function sourceMeta(sourceType: string | null, sourceUrl: string | null): SourceMeta {
  const type = (sourceType ?? '').toLowerCase();
  for (const [needle, meta] of SOURCE_MATCHERS) {
    if (type.includes(needle)) return meta;
  }
  return { ...WEB, label: hostLabel(sourceUrl) ?? WEB.label };
}

/** `https://www.eater.com/maps/x` → `eater.com`; undefined when unparseable. */
function hostLabel(url: string | null): string | undefined {
  if (!url) return undefined;
  const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  const host = match?.[1]?.replace(/^www\./i, '');
  return host && host.includes('.') ? host : undefined;
}
