import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/**
 * OpenAI vision accepts JPEG, PNG, GIF, and WebP. iOS Photos commonly returns
 * HEIC, so normalize every local image to JPEG before sending it to the API.
 */
export async function visionImageBase64(uri: string): Promise<string> {
  const result = await manipulateAsync(
    uri,
    [],
    {
      base64: true,
      compress: 0.82,
      format: SaveFormat.JPEG,
    },
  );

  if (!result.base64) throw new Error('The selected image could not be prepared for recognition.');
  return result.base64;
}
