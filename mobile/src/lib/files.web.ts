/** Anything picked by the document or image picker. */
export type PickedFile = { uri: string; file?: File | null };

/** Web: pickers give a browser File object (or a blob: uri). */
export async function readPickedFile(asset: PickedFile): Promise<ArrayBuffer> {
  if (asset.file) return asset.file.arrayBuffer();
  return (await fetch(asset.uri)).arrayBuffer();
}
