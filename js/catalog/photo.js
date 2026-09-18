/** Max edge length (px) for catalog photos before JPEG encode. */
export const PHOTO_MAX_EDGE = 800;

/** JPEG quality ~0.7 for .weebi BLOBs. */
export const PHOTO_JPEG_QUALITY = 0.7;

/**
 * Scale so the longest edge is at most maxEdge (no upscale).
 * @param {number} width
 * @param {number} height
 * @param {number} [maxEdge]
 * @returns {{ width: number, height: number }}
 */
export function computeResizeDimensions(width, height, maxEdge = PHOTO_MAX_EDGE) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const edge = Math.max(1, Number(maxEdge) || PHOTO_MAX_EDGE);
  const longest = Math.max(w, h);
  if (longest <= edge) {
    return { width: w, height: h };
  }
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * Resize an image Blob/File to JPEG bytes (browser Canvas API).
 * @param {Blob|File} source
 * @param {{
 *   maxEdge?: number,
 *   quality?: number,
 *   createImageBitmap?: typeof createImageBitmap,
 *   document?: Document,
 * }} [options]
 * @returns {Promise<{ data: Uint8Array, extension: string }>}
 */
export async function resizeImageToJpeg(source, options = {}) {
  const maxEdge = options.maxEdge ?? PHOTO_MAX_EDGE;
  const quality = options.quality ?? PHOTO_JPEG_QUALITY;
  const bitmapFn =
    options.createImageBitmap ??
    (typeof createImageBitmap === 'function' ? createImageBitmap : null);
  const doc = options.document ?? (typeof document !== 'undefined' ? document : null);

  if (!bitmapFn || !doc) {
    throw new Error('resizeImageToJpeg nécessite un navigateur (canvas)');
  }

  const bitmap = await bitmapFn(source);
  try {
    const { width, height } = computeResizeDimensions(
      bitmap.width,
      bitmap.height,
      maxEdge,
    );
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas 2d indisponible');
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('échec encodage JPEG'))),
        'image/jpeg',
        quality,
      );
    });
    const buf = await blob.arrayBuffer();
    return { data: new Uint8Array(buf), extension: 'jpeg' };
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}
