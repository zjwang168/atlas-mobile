import Svg, { Path } from 'react-native-svg';

/** Compact document-and-microphone mark, proportioned for the Atlas note button. */
export function AtlasTranscriptionIcon({ size = 19, color = '#176C59' }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <Path d="M13 8H39M13 8V56H43M13 56H43M13 8H13" stroke={color} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M22 36H34M22 45H38" stroke={color} strokeWidth={6} strokeLinecap="square" />
    <Path d="M44 10V23C44 28 47 31 50 31C53 31 56 28 56 23V10C56 5 53 2 50 2C47 2 44 5 44 10Z" fill={color} />
    <Path d="M39 26C39 35 44 41 50 41C56 41 61 35 61 26M50 41V53" stroke={color} strokeWidth={6} strokeLinecap="round" />
  </Svg>;
}
