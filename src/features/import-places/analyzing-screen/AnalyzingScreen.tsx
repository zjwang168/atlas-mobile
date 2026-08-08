import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Reanimated, { FadeInUp, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ParseProgressEvent } from '../../../services/api/apiService';
import { getRegionPhoto } from '../../../services/api/apiService';
import { typography } from '../../../theme/typography';

const COLOR = {
  accent: '#12C170',
  accentStrong: '#0C8149',
  accentSoft: '#E9FBF1',
  textPrimary: '#1A1A1A',
  textSecondary: '#626B68',
  textTertiary: '#8B9590',
  background: '#F7FAF8',
  surface: '#FFFFFF',
  border: '#E5ECE8',
} as const;

type AnalyzingMode =
  | 'parse'
  | 'smart_text'
  | 'atlas_discover'
  | 'image_scan'
  | 'web_scrape'
  | 'youtube_links'
  | 'tiktok_links'
  | 'instagram_reels'
  | 'facebook_reels'
  | 'find_image_places';

type AnalyzingScreenProps = {
  url: string;
  mode?: AnalyzingMode;
  progressEvents?: ParseProgressEvent[];
  onDismiss: () => void;
  onCancel: () => void;
  onHeroReady?: () => void;
};

type AnalysisEntry = {
  key: string;
  title: string;
  detail: string;
  elapsed: number;
  category: string;
};

function countFrom(event: ParseProgressEvent): number | null {
  const count = event.data?.location_count ?? event.data?.resolved_count;
  return typeof count === 'number' ? count : null;
}

function pluralizePlaces(count: number): string {
  return `${count} place${count === 1 ? '' : 's'}`;
}

function inferredRegion(events: ParseProgressEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index].data?.region ?? events[index].data?.inferred_region;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function cityName(region: string | null): string | null {
  if (!region) return null;
  return region.split(',')[0].trim().replace(/\s+/g, ' ') || null;
}

function inferredTagline(events: ParseProgressEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index].data?.tagline;
    if (typeof value !== 'string') continue;
    const tagline = value.trim().replace(/\s+/g, ' ');
    const words = tagline.split(' ');
    if (tagline.length <= 36 && words.length >= 2 && words.length <= 4) return tagline;
  }
  return null;
}

function sessionTitle(events: ParseProgressEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index].data?.title;
    if (typeof value !== 'string') continue;
    const title = value.trim().replace(/\s+/g, ' ');
    if (title && /[a-z]/i.test(title) && title.length <= 90) return title;
  }
  return null;
}

function placeNameFromEvent(event: ParseProgressEvent): string | null {
  const value = event.data?.name ?? event.data?.place_name ?? event.data?.location_name;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function describeEvent(event: ParseProgressEvent, mode?: AnalyzingMode): AnalysisEntry | null {
  const count = countFrom(event);
  const base = {
    key: event.key,
    elapsed: event.elapsed_s,
  };

  if (event.key === 'started') {
    const title = mode === 'find_image_places'
      ? 'Preparing the image'
      : mode === 'image_scan'
        ? 'Preparing image text recognition'
        : mode === 'youtube_links'
          ? 'Opening the video'
          : mode === 'tiktok_links'
            ? 'Opening the video'
          : mode === 'instagram_reels'
            ? 'Opening the Reel'
          : mode === 'facebook_reels'
            ? 'Opening the Reel'
          : mode === 'smart_text'
            ? 'Reading your pasted text'
            : 'Opening the source';
    return { ...base, category: 'start', title, detail: 'Setting up the analysis.' };
  }

  if (event.key === 'source_fetched') {
    return { ...base, category: 'source-ready', title: 'Source is ready', detail: 'The relevant content is ready for place analysis.' };
  }
  if (event.key === 'entity_linking_done') {
    return {
      ...base,
      category: 'places-found',
      title: count === null ? 'Place references found' : `${pluralizePlaces(count)} found`,
      detail: 'Checking which references describe real, visitable places.',
    };
  }
  if (event.label === 'place:identified') {
    const name = placeNameFromEvent(event);
    if (!name) return null;
    return { ...base, category: 'place-identified', title: `Identified ${name}`, detail: 'Checking this place against the source context.' };
  }
  if (event.label === 'place:matched') {
    const name = placeNameFromEvent(event);
    if (!name) return null;
    return { ...base, category: 'place-matched', title: `Located ${name}`, detail: 'Confirmed a map position for this place.' };
  }
  if (event.key === 'geocode_done') {
    return {
      ...base,
      category: 'map-matched',
      title: count === null ? 'Matching places to the map' : `${pluralizePlaces(count)} matched to the map`,
      detail: 'Verifying the most relevant map result for each place.',
    };
  }
  if (event.key === 'finished') {
    return { ...base, category: 'finished', title: 'Preparing your results', detail: 'The places are ready to review.' };
  }

  const stage = event.data?.stage;
  if (event.label === 'image:ocr') {
    return {
      ...base,
      category: stage === 'started' ? 'ocr-started' : 'ocr-ready',
      title: stage === 'started' ? 'Reading text in the image' : 'Text from the image is ready',
      detail: stage === 'started'
        ? 'Looking for place names, addresses, and useful context.'
        : 'Passing the recognized text to location analysis.',
    };
  }
  if (event.label === 'image:classify') {
    return {
      ...base,
      category: stage === 'started' ? 'image-classify-started' : 'image-classify-ready',
      title: stage === 'started' ? 'Understanding the image text' : 'Choosing the best analysis path',
      detail: 'Determining whether the text contains named places or precise addresses.',
    };
  }
  if (event.label === 'image:vision') {
    return {
      ...base,
      category: stage === 'started' ? 'vision-started' : 'vision-ready',
      title: stage === 'started' ? 'Examining visual landmarks' : 'Visual clues reviewed',
      detail: stage === 'started'
        ? 'Looking at buildings, signs, terrain, and other location clues.'
        : 'Checking the strongest location candidate against the image.',
    };
  }
  if (event.label === 'image:location') {
    const location = typeof event.data?.region === 'string' ? event.data.region : null;
    return {
      ...base,
      category: 'image-location',
      title: stage === 'no_candidate' ? 'No confident landmark found' : location ? `Verifying ${location}` : 'Verifying the location candidate',
      detail: stage === 'no_candidate'
        ? 'The image did not provide enough reliable location evidence.'
        : 'Preparing the map location for review.',
    };
  }
  if (event.label === 'youtube:fetch') {
    return { ...base, category: 'youtube-fetch', title: 'Collecting video context', detail: 'Loading the transcript and chapter information.' };
  }
  if (event.label === 'youtube:transcript') {
    return { ...base, category: 'youtube-transcript', title: 'Reviewing the video transcript', detail: 'Using spoken mentions and chapter context to find places.' };
  }
  if (event.label === 'youtube:deepseek') {
    return { ...base, category: 'youtube-analysis', title: 'Connecting location clues', detail: 'Interpreting the video context to identify visitable places.' };
  }
  if (event.label === 'youtube:geocode') {
    return { ...base, category: 'youtube-map', title: 'Checking video locations on the map', detail: 'Resolving the references against the video context.' };
  }
  if (event.label === 'tiktok:fetch') {
    return { ...base, category: 'tiktok-fetch', title: 'Collecting video context', detail: 'Loading the public caption and metadata.' };
  }
  if (event.label === 'tiktok:caption') {
    return { ...base, category: 'tiktok-caption', title: 'Reviewing the video caption', detail: 'Using captions and hashtags to find place references.' };
  }
  if (event.label === 'tiktok:transcribe') {
    return { ...base, category: 'tiktok-transcribe', title: 'Adding spoken context', detail: 'The caption was not specific enough, so Atlas is requesting subtitles or a speech-to-text transcript.' };
  }
  if (event.label === 'tiktok:transcript') {
    return { ...base, category: 'tiktok-transcript', title: 'Reviewing spoken place references', detail: 'Using the video transcript to find places that were not written in the caption.' };
  }
  if (event.label === 'tiktok:deepseek') {
    return { ...base, category: 'tiktok-analysis', title: 'Connecting location clues', detail: 'Interpreting the video context to identify visitable places.' };
  }
  if (event.label === 'tiktok:geocode') {
    return { ...base, category: 'tiktok-map', title: 'Checking video locations on the map', detail: 'Resolving the references against the video context.' };
  }
  if (event.label === 'instagram:fetch') {
    return { ...base, category: 'instagram-fetch', title: 'Collecting Reel context', detail: 'Loading the public caption and metadata.' };
  }
  if (event.label === 'instagram:caption') {
    return { ...base, category: 'instagram-caption', title: 'Reviewing the Reel caption', detail: 'Using captions, hashtags, and tagged locations to find place references.' };
  }
  if (event.label === 'instagram:transcribe') {
    return { ...base, category: 'instagram-transcribe', title: 'Adding spoken context', detail: 'The caption was not specific enough, so Atlas is requesting a Reel audio transcript.' };
  }
  if (event.label === 'instagram:transcript') {
    return { ...base, category: 'instagram-transcript', title: 'Reviewing spoken place references', detail: 'Using the Reel transcript to find places that were not written in the caption.' };
  }
  if (event.label === 'instagram:deepseek') {
    return { ...base, category: 'instagram-analysis', title: 'Connecting location clues', detail: 'Interpreting the Reel context to identify visitable places.' };
  }
  if (event.label === 'instagram:geocode') {
    return { ...base, category: 'instagram-map', title: 'Checking Reel locations on the map', detail: 'Resolving the references against the Reel context.' };
  }
  if (event.label === 'facebook:fetch') {
    return { ...base, category: 'facebook-fetch', title: 'Collecting Reel context', detail: 'Loading the public Reel text and metadata.' };
  }
  if (event.label === 'facebook:caption') {
    return { ...base, category: 'facebook-caption', title: 'Reviewing the Reel text', detail: 'Using public Reel text to find place references.' };
  }
  if (event.label === 'facebook:transcript') {
    return { ...base, category: 'facebook-transcript', title: 'Reviewing public captions', detail: 'Using Facebook captions to find spoken place references.' };
  }
  if (event.label === 'facebook:captions_unavailable') {
    return { ...base, category: 'facebook-captions-unavailable', title: 'No public captions available', detail: 'Continuing with the Reel text that Facebook made public.' };
  }
  if (event.label === 'facebook:deepseek') {
    return { ...base, category: 'facebook-analysis', title: 'Connecting location clues', detail: 'Interpreting the Reel context to identify visitable places.' };
  }
  if (event.label === 'facebook:geocode') {
    return { ...base, category: 'facebook-map', title: 'Checking Reel locations on the map', detail: 'Resolving the references against the Reel context.' };
  }
  if (event.label === 'analysis:region') {
    const region = typeof event.data?.region === 'string' ? event.data.region : 'the inferred region';
    return { ...base, category: 'region', title: `Focusing on ${cityName(region) || region}`, detail: 'Using regional context to keep map matches precise.' };
  }
  if (event.label === 'Fetching source') {
    return { ...base, category: 'fetch', title: 'Reading the source', detail: 'Collecting the content that may contain place references.' };
  }
  if (event.label === 'Analyzing source' || event.label === 'Analyzing text' || event.label === 'Analyzing') {
    return { ...base, category: 'analyzing', title: 'Understanding the content', detail: 'Looking for places and the context that distinguishes them.' };
  }
  if (event.label === 'langchain:translate') {
    return { ...base, category: 'translate', title: 'Normalizing the language', detail: 'Preserving place names while preparing the content for matching.' };
  }
  if (event.label === 'langchain:route') {
    return { ...base, category: 'analysis-path', title: 'Choosing an analysis path', detail: 'Using the content type to select the most reliable place-matching approach.' };
  }
  if (event.label === 'langchain:extract:start' || event.label === 'smart_text:deepseek') {
    return { ...base, category: 'extract', title: 'Finding place references', detail: 'Separating useful locations from general travel commentary.' };
  }
  if (event.label === 'langchain:extract:filter') {
    return { ...base, category: 'filter', title: 'Removing broad and duplicate references', detail: 'Keeping the specific places that are useful on a map.' };
  }
  if (event.label === 'langchain:extract:validate') {
    return { ...base, category: 'validate', title: 'Checking place context', detail: 'Confirming each reference belongs to the right area.' };
  }
  if (event.label === 'smart_text:web_search') {
    return { ...base, category: 'research', title: 'Checking current references', detail: 'Looking up the live context requested for this import.' };
  }
  if (event.label === 'smart_text:geocode' || event.label === 'youtube:geocode' || event.label === 'tiktok:geocode') {
    return { ...base, category: 'geocode', title: 'Matching places to the map', detail: 'Checking the most relevant result for each location.' };
  }
  if (event.label === 'Routing' || event.label === 'smart_text:route') {
    return { ...base, category: 'route', title: 'Organizing the results', detail: 'Preparing the verified places for review.' };
  }
  if (event.label.startsWith('deepseek:') || event.label.startsWith('qwen:') || event.label.startsWith('hunyuan:')) {
    const detail = typeof event.data?.detail === 'string'
      ? event.data.detail
      : 'Comparing the source details to resolve ambiguous references.';
    return { ...base, category: 'model-review', title: 'Reviewing place context', detail };
  }

  return null;
}

function AnalysisRow({ entry, current }: { entry: AnalysisEntry; current: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!current) return undefined;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 920, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 920, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [current, pulse]);

  return (
    <Reanimated.View
      entering={FadeInUp.springify().damping(16).stiffness(280).mass(0.52)}
      layout={LinearTransition.springify().damping(17).stiffness(245).mass(0.58)}
      style={[styles.analysisRow, current && styles.analysisRowCurrent]}
    >
      <View style={[styles.statusDot, current ? styles.statusDotCurrent : styles.statusDotDone]}>
        {current ? (
          <>
            <Animated.View
              style={[
                styles.statusDotPulse,
                {
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.26, 0] }),
                  transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.78] }) }],
                },
              ]}
            />
            <View style={styles.statusDotInner} />
          </>
        ) : <Ionicons name="checkmark" size={12} color="#87918C" />}
      </View>
      <View style={styles.analysisText}>
        <View style={styles.analysisTitleRow}>
          <Text style={[styles.analysisTitle, current && styles.analysisTitleCurrent]}>{entry.title}</Text>
          <Text style={[styles.analysisTime, current && styles.analysisTimeCurrent]}>{entry.elapsed}s</Text>
        </View>
        {current ? <Text style={styles.analysisDetail}>{entry.detail}</Text> : null}
      </View>
    </Reanimated.View>
  );
}

function SourceIcon({ mode }: { mode?: AnalyzingMode }) {
  if (mode === 'youtube_links') return <Ionicons name="logo-youtube" size={17} color="#FFFFFF" />;
  if (mode === 'tiktok_links') return <Ionicons name="logo-tiktok" size={17} color="#FFFFFF" />;
  if (mode === 'instagram_reels') return <Ionicons name="logo-instagram" size={17} color="#FFFFFF" />;
  if (mode === 'facebook_reels') return <Ionicons name="logo-facebook" size={17} color="#FFFFFF" />;
  if (mode === 'image_scan' || mode === 'find_image_places') return <Ionicons name="image-outline" size={17} color="#FFFFFF" />;
  if (mode === 'smart_text') return <Ionicons name="document-text-outline" size={17} color="#FFFFFF" />;
  return <Ionicons name="link-outline" size={17} color="#FFFFFF" />;
}

function localeTagline(region: string | null, title: string): string | undefined {
  const key = title.toLowerCase();
  const curated: Record<string, string> = {
    paris: 'CITY OF LIGHT',
    manila: 'NATIONAL CAPITAL REGION',
    'new york': 'THE CITY THAT NEVER SLEEPS',
    tokyo: 'KANTO, JAPAN',
  };
  if (curated[key]) return curated[key];
  const suffix = region?.split(',').slice(1).join(',').trim();
  return suffix ? suffix.toUpperCase() : 'LOCAL GUIDE';
}

function PlaceTitle({
  title,
  region,
  tagline,
  titleReveal,
  taglineReveal,
}: {
  title: string;
  region: string | null;
  tagline: string | null;
  titleReveal: Animated.Value;
  taglineReveal: Animated.Value;
}) {
  const displayTagline = tagline || localeTagline(region, title);
  return (
    <View pointerEvents="none" style={styles.heroTitleFrame}>
      <Animated.Text
        style={[styles.heroTitle, { opacity: titleReveal, transform: [{ translateY: titleReveal.interpolate({ inputRange: [0, 1], outputRange: [9, 0] }) }] }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {title}
      </Animated.Text>
      <Animated.Text
        style={[styles.heroTagline, { opacity: taglineReveal, transform: [{ translateY: taglineReveal.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}
        numberOfLines={1}
      >
        {displayTagline}
      </Animated.Text>
    </View>
  );
}

export default function AnalyzingScreen({
  url,
  mode,
  progressEvents = [],
  onDismiss,
  onCancel,
  onHeroReady,
}: AnalyzingScreenProps) {
  const insets = useSafeAreaInsets();
  const [elapsed, setElapsed] = useState(0);
  const [regionPhotos, setRegionPhotos] = useState<string[]>([]);
  const [photoLayers, setPhotoLayers] = useState<[string | null, string | null]>([null, null]);
  const [frontPhotoLayer, setFrontPhotoLayer] = useState<0 | 1>(0);
  const [transitionPhotoLayer, setTransitionPhotoLayer] = useState<0 | 1 | null>(null);
  const pulse = useRef(new Animated.Value(0.35)).current;
  const imageReveal = useRef(new Animated.Value(0)).current;
  const photoCrossfade = useRef(new Animated.Value(0)).current;
  const heroTitleReveal = useRef(new Animated.Value(0)).current;
  const heroTaglineReveal = useRef(new Animated.Value(0)).current;
  const placeholderPulse = useRef(new Animated.Value(0)).current;
  const placeholderScan = useRef(new Animated.Value(0)).current;
  const photoTransitionActive = useRef(false);
  const regionPhotoIndexRef = useRef(0);
  const frontPhotoLayerRef = useRef<0 | 1>(0);
  const pendingPhotoRef = useRef<{ layer: 0 | 1; index: number; uri: string } | null>(null);
  const heroPhotoReadyRef = useRef(false);

  const region = useMemo(() => inferredRegion(progressEvents), [progressEvents]);
  const regionTagline = useMemo(() => inferredTagline(progressEvents), [progressEvents]);
  const city = cityName(region);
  const importedTitle = useMemo(() => sessionTitle(progressEvents), [progressEvents]);

  useEffect(() => {
    let active = true;
    setRegionPhotos([]);
    regionPhotoIndexRef.current = 0;
    setPhotoLayers([null, null]);
    setFrontPhotoLayer(0);
    frontPhotoLayerRef.current = 0;
    setTransitionPhotoLayer(null);
    pendingPhotoRef.current = null;
    heroPhotoReadyRef.current = false;
    imageReveal.setValue(0);
    photoCrossfade.setValue(0);
    heroTitleReveal.setValue(0);
    heroTaglineReveal.setValue(0);
    photoTransitionActive.current = false;
    if (!region) return () => { active = false; };
    getRegionPhoto(region)
      .then(({ photo_url, photo_urls }) => {
        if (!active) return;
        const photos = Array.from(new Set((photo_urls?.length ? photo_urls : photo_url ? [photo_url] : []).filter(Boolean)));
        setRegionPhotos(photos);
        setPhotoLayers([photos[0] || null, null]);
      })
      .catch(() => {
        // A photo enriches the wait state but is never required for parsing.
      });
    return () => { active = false; };
  }, [imageReveal, region]);

  useEffect(() => {
    if (regionPhotos.length < 2) return;
    let active = true;
    const intervalId = setInterval(() => {
      if (photoTransitionActive.current) return;
      const nextIndex = (regionPhotoIndexRef.current + 1) % regionPhotos.length;
      const incomingLayer = frontPhotoLayerRef.current === 0 ? 1 : 0;
      photoTransitionActive.current = true;
      const uri = regionPhotos[nextIndex];
      pendingPhotoRef.current = { layer: incomingLayer, index: nextIndex, uri };
      photoCrossfade.setValue(0);
      // The non-visible layer is allowed to load or fail independently. The
      // current photograph stays untouched until its replacement reports
      // onLoad, so a cache miss cannot create a black or stale frame.
      setPhotoLayers((layers) => incomingLayer === 0 ? [uri, layers[1]] : [layers[0], uri]);
    }, 5600);
    return () => {
      active = false;
      clearInterval(intervalId);
      photoTransitionActive.current = false;
    };
  }, [photoCrossfade, regionPhotos]);

  const handlePhotoLoad = (layer: 0 | 1, uri: string) => {
    const pending = pendingPhotoRef.current;
    if (!pending) {
      if (layer !== frontPhotoLayerRef.current || heroPhotoReadyRef.current) return;
      heroPhotoReadyRef.current = true;
      Animated.timing(imageReveal, { toValue: 1, duration: 480, useNativeDriver: true }).start(({ finished }) => {
        if (!finished) return;
        Animated.sequence([
          Animated.delay(120),
          Animated.timing(heroTitleReveal, { toValue: 1, duration: 420, useNativeDriver: true }),
          Animated.delay(90),
          Animated.timing(heroTaglineReveal, { toValue: 1, duration: 300, useNativeDriver: true }),
        ]).start(({ finished: textFinished }) => {
          if (textFinished) onHeroReady?.();
        });
      });
      return;
    }
    if (pending.layer !== layer || pending.uri !== uri) return;
    pendingPhotoRef.current = null;
    setTransitionPhotoLayer(layer);
    Animated.timing(photoCrossfade, {
      toValue: 1,
      duration: 720,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      regionPhotoIndexRef.current = pending.index;
      frontPhotoLayerRef.current = layer;
      setFrontPhotoLayer(layer);
      setTransitionPhotoLayer(null);
      photoTransitionActive.current = false;
    });
  };

  const handlePhotoError = (layer: 0 | 1, uri: string) => {
    const pending = pendingPhotoRef.current;
    if (!pending) {
      if (layer === frontPhotoLayerRef.current) {
        setPhotoLayers([null, null]);
        setRegionPhotos([]);
      }
      return;
    }
    if (pending.layer !== layer || pending.uri !== uri) return;
    pendingPhotoRef.current = null;
    photoTransitionActive.current = false;
  };

  useEffect(() => {
    const startedAt = Date.now();
    const intervalId = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 780, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 780, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(placeholderPulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(placeholderPulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    const scan = Animated.loop(
      Animated.timing(placeholderScan, { toValue: 1, duration: 2100, useNativeDriver: true }),
    );
    breathing.start();
    scan.start();
    return () => {
      breathing.stop();
      scan.stop();
    };
  }, [placeholderPulse, placeholderScan]);

  const entries = useMemo(() => {
    const mapped = progressEvents
      .map((event, index) => {
        const entry = describeEvent(event, mode);
        // The index is stable while a request appends events. It also protects
        // the UI from old backend events that reused a timestamp-based key.
        return entry ? { ...entry, key: `${entry.key}:${index}` } : null;
      })
      .filter((entry): entry is AnalysisEntry => entry !== null);
    const unique: AnalysisEntry[] = [];
    const seen = new Set<string>();
    for (let index = mapped.length - 1; index >= 0; index -= 1) {
      const entry = mapped[index];
      const semanticKey = `${entry.category}:${entry.title}`;
      if (seen.has(semanticKey)) continue;
      seen.add(semanticKey);
      unique.push(entry);
    }
    return unique.slice(0, 12);
  }, [mode, progressEvents]);

  const currentIndex = 0;
  const sourceName = /(?:reddit\.com|redd\.it)/i.test(url)
    ? 'Reddit'
    : mode === 'youtube_links'
      ? 'YouTube'
      : mode === 'tiktok_links'
        ? 'TikTok'
      : mode === 'instagram_reels'
        ? 'Instagram'
      : mode === 'facebook_reels'
        ? 'Facebook'
      : mode === 'image_scan'
        ? 'image text'
        : mode === 'find_image_places'
          ? 'a photo'
          : mode === 'smart_text'
            ? 'your notes'
            : mode === 'web_scrape'
              ? 'a webpage'
              : 'this link';
  const sourceLabel = city
    ? `Extracting places from ${sourceName} in ${city}`
    : importedTitle
      ? `Extracting places from ${importedTitle}`
      : `Extracting places from ${sourceName}`;

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity accessibilityLabel="Hide analysis" style={styles.closeButton} onPress={onDismiss} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={COLOR.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.sourcePill}>
          <View style={styles.sourceIcon}><SourceIcon mode={mode} /></View>
          <Text style={styles.sourceLabel} numberOfLines={1}>{sourceLabel}</Text>
        </View>

        <View style={styles.hero}>
          {regionPhotos.length ? (
            <>
              {photoLayers.map((uri, index) => {
                if (!uri) return null;
                const layer = index as 0 | 1;
                const isFront = layer === frontPhotoLayer;
                const isTransition = layer === transitionPhotoLayer;
                return (
                  <Animated.View
                    key={`photo-layer-${layer}`}
                    style={[
                      styles.heroImageWrap,
                      { zIndex: isTransition ? 2 : isFront ? 1 : 0, opacity: isTransition ? photoCrossfade : isFront ? imageReveal : 0 },
                    ]}
                  >
                    <Image source={{ uri }} style={styles.heroImage} resizeMode="cover" onLoad={() => handlePhotoLoad(layer, uri)} onError={() => handlePhotoError(layer, uri)} />
                  </Animated.View>
                );
              })}
              <PlaceTitle key={city || region} title={city || region || ''} region={region} tagline={regionTagline} titleReveal={heroTitleReveal} taglineReveal={heroTaglineReveal} />
            </>
          ) : (
            <View style={styles.heroPlaceholder}>
              <Animated.View style={[styles.placeholderTint, { opacity: placeholderPulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.28] }) }]} />
              <Animated.View pointerEvents="none" style={[styles.placeholderBorder, { opacity: placeholderPulse.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.48] }), transform: [{ scale: placeholderPulse.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1] }) }] }]} />
              <View style={styles.placeholderSignalTrack}>
                <Animated.View style={[styles.placeholderSignal, { opacity: placeholderPulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.72] }), transform: [{ translateX: placeholderScan.interpolate({ inputRange: [0, 1], outputRange: [-48, 48] }) }, { scaleX: placeholderPulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] }]} />
              </View>
              <Text style={styles.heroPlaceholderTitle}>Atlas is connecting the dots</Text>
              <Text style={styles.heroPlaceholderDetail}>Reading the clues that reveal where this story takes place.</Text>
            </View>
          )}
        </View>

        <View style={styles.analysisPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>In progress</Text>
            <Text style={styles.elapsed}>{elapsed}s</Text>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {entries.length > 0 ? entries.map((entry, index) => (
              <AnalysisRow key={entry.key} entry={entry} current={index === currentIndex} />
            )) : (
              <View style={styles.waitingRow}>
                <Animated.View style={[styles.waitingDot, { opacity: pulse }]} />
                <Text style={styles.waitingText}>Connecting to the analysis pipeline</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} activeOpacity={0.8}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: COLOR.background, zIndex: 100 },
  topBar: { alignItems: 'flex-end', paddingHorizontal: 20 },
  closeButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(26,26,26,0.06)', alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 30 },
  sourcePill: { alignSelf: 'center', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 22, backgroundColor: COLOR.surface, paddingVertical: 7, paddingLeft: 7, paddingRight: 15, borderWidth: 1, borderColor: COLOR.border },
  sourceIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: COLOR.accent },
  sourceLabel: { flexShrink: 1, ...typography.bodyEmphasis, color: COLOR.textPrimary },
  hero: { marginTop: 28, width: '100%', aspectRatio: 1.72, borderRadius: 28, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#F0F2F0' },
  heroImageWrap: { ...StyleSheet.absoluteFill },
  heroImage: { ...StyleSheet.absoluteFill },
  heroTitleFrame: { ...StyleSheet.absoluteFill, zIndex: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  heroTitle: { color: '#FFFFFF', fontSize: 34, lineHeight: 41, fontWeight: '600', letterSpacing: 0, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 7 },
  heroTagline: { marginTop: 6, color: 'rgba(255,255,255,0.88)', fontSize: 10, lineHeight: 13, fontWeight: '700', letterSpacing: 1.4, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.25)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5 },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, overflow: 'hidden' },
  placeholderTint: { ...StyleSheet.absoluteFill, backgroundColor: '#DDE5DF' },
  placeholderBorder: { position: 'absolute', top: 1, right: 1, bottom: 1, left: 1, borderRadius: 27, borderCurve: 'continuous', borderWidth: 1, borderColor: '#AAB7AF' },
  placeholderSignalTrack: { width: 104, height: 4, overflow: 'hidden', borderRadius: 2, backgroundColor: 'rgba(76, 91, 83, 0.11)', marginBottom: 15 },
  placeholderSignal: { width: 58, height: 4, borderRadius: 2, backgroundColor: '#7F9087' },
  heroPlaceholderTitle: { marginTop: 4, color: COLOR.textPrimary, fontSize: 22, lineHeight: 29, fontWeight: '700', textAlign: 'center' },
  heroPlaceholderDetail: { marginTop: 8, maxWidth: 270, color: COLOR.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  analysisPanel: { flex: 1, minHeight: 220, maxHeight: 340, marginTop: 18, backgroundColor: COLOR.surface, borderRadius: 28, borderCurve: 'continuous', borderWidth: 1, borderColor: COLOR.border, overflow: 'hidden' },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 17, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLOR.border },
  panelTitle: { ...typography.bodyEmphasis, color: COLOR.textPrimary },
  elapsed: { fontSize: 12, color: COLOR.textTertiary, fontVariant: ['tabular-nums'] },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 17, paddingVertical: 8 },
  analysisRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingHorizontal: 6, paddingVertical: 9 },
  analysisRowCurrent: { marginVertical: 3, borderRadius: 8, backgroundColor: '#F0FBF5', paddingHorizontal: 10, paddingVertical: 12 },
  statusDot: { width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  statusDotCurrent: { backgroundColor: COLOR.accent },
  statusDotDone: { backgroundColor: '#EEF2F0' },
  statusDotPulse: { position: 'absolute', width: 21, height: 21, borderRadius: 11, backgroundColor: COLOR.accent },
  statusDotInner: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },
  analysisText: { flex: 1, minWidth: 0 },
  analysisTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  analysisTitle: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '500', color: COLOR.textSecondary },
  analysisTitleCurrent: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: COLOR.textPrimary },
  analysisTime: { fontSize: 11, color: COLOR.textTertiary, fontVariant: ['tabular-nums'] },
  analysisTimeCurrent: { color: COLOR.accentStrong, fontWeight: '600' },
  analysisDetail: { marginTop: 4, fontSize: 13, lineHeight: 19, color: COLOR.textSecondary },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  waitingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR.accent },
  waitingText: { fontSize: 14, color: COLOR.textSecondary },
  bottomBar: { alignItems: 'center', paddingTop: 16 },
  cancelButton: { minWidth: 132, alignItems: 'center', paddingHorizontal: 30, paddingVertical: 13, borderRadius: 22, backgroundColor: 'rgba(26,26,26,0.06)' },
  cancelText: { ...typography.bodyEmphasis, color: COLOR.textSecondary },
});
