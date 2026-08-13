import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { Text } from '@/components/ui/text';
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { styles } from './styles';

function TypewriterCharacter({ character, index, progress }: { character: string; index: number; progress: { value: number } }) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [index - 0.25, index + 0.55], [0, 1], Extrapolation.CLAMP),
  }));
  return <Reanimated.View style={animatedStyle}><Text style={styles.emptyAtlasHint}>{character}</Text></Reanimated.View>;
}

function TypewriterHint({ text = 'Tap a pin, and add it.' }: { text?: string }) {
  const characters = text.split('');
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(withTiming(characters.length + 0.5, { duration: 2500 }), -1, false);
  }, [characters.length, progress]);
  return <View style={styles.typewriterLine}>{characters.map((character, index) => <TypewriterCharacter key={`${character}-${index}`} character={character} index={index} progress={progress} />)}</View>;
}

export function AtlasEmptySkeleton() {
  const pulse = useRef(new Animated.Value(0.58)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.58, duration: 1800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return <Animated.View style={[styles.emptyAtlas, { opacity: pulse }]}>
    <View style={styles.emptyAtlasIntro}>
      <View style={styles.emptyAtlasKicker} />
      <View style={styles.emptyAtlasTitle} />
    </View>
    {[0, 1, 2].map((index) => <View key={index} style={styles.emptyAtlasGroup}>
      <View style={styles.emptyAtlasActions}>
        <View style={styles.emptyAtlasAction} />
        <View style={[styles.emptyAtlasAction, styles.emptyAtlasActionShort]} />
      </View>
      <View style={styles.emptyAtlasRow}>
        <View style={styles.emptyAtlasOrder} />
        <View style={styles.emptyAtlasImage} />
        <View style={styles.emptyAtlasCopy}>
          {index === 0 ? <>
            <TypewriterHint />
            <Text style={styles.emptyAtlasHintSub}>Now, add your first pin.</Text>
          </> : index === 1 ? <>
            <TypewriterHint text="Or search a pin, and add it." />
            <View style={[styles.emptyAtlasLine, styles.emptyAtlasLineShort]} />
          </> : <>
            <View style={styles.emptyAtlasLine} />
            <View style={[styles.emptyAtlasLine, styles.emptyAtlasLineShort]} />
          </>}
        </View>
        <View style={styles.emptyAtlasHandle} />
      </View>
      {index < 2 ? <View style={styles.emptyAtlasConnector} /> : null}
    </View>)}
  </Animated.View>;
}
