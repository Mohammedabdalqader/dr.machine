import type { DocumentPickerAsset } from 'expo-document-picker';

/** Web: the picker gives a browser File object. */
export async function readPickedFile(asset: DocumentPickerAsset): Promise<ArrayBuffer> {
  if (asset.file) return asset.file.arrayBuffer();
  return (await fetch(asset.uri)).arrayBuffer();
}
