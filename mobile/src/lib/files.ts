import type { DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';

/** Reads a picked document as bytes (native: content:// or file:// uri). */
export async function readPickedFile(asset: DocumentPickerAsset): Promise<ArrayBuffer> {
  return new File(asset.uri).arrayBuffer();
}
