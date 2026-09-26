import { File } from 'expo-file-system';

/** Anything picked by the document or image picker. */
export type PickedFile = { uri: string; file?: globalThis.File | null };

/** Reads a picked file as bytes (native: content:// or file:// uri). */
export async function readPickedFile(asset: PickedFile): Promise<ArrayBuffer> {
  return new File(asset.uri).arrayBuffer();
}
