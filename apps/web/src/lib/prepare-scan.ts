// Prepares a picked invoice file for upload + Claude vision:
//  - HEIC/HEIF (iPhone default) → JPEG, because Claude cannot decode HEIC image blocks.
//  - Large photos → downscaled so the long edge is <= MAX_EDGE and re-encoded as JPEG,
//    keeping the base64 payload well under Claude's ~5 MB per-image limit while staying
//    legible for text extraction.
//  - PDFs pass through unchanged (handled by the document block, not vision downscaling).
// Runs entirely in the browser; heic2any is imported lazily so it never bloats the main bundle.

const MAX_EDGE = 2000;       // long-edge cap in px — ample for reading a document photo
const JPEG_QUALITY = 0.85;

const HEIC_TYPES = ['image/heic', 'image/heif'];
const isHeic = (f: File): boolean =>
  HEIC_TYPES.includes(f.type) || /\.(heic|heif)$/i.test(f.name);

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
    img.src = url;
  });
}

function canvasToJpegFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) { reject(new Error('canvas encode failed')); return; }
        resolve(new File([blob], name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

// Returns a File ready to upload: JPEG for any image input (converted + downscaled as
// needed), or the original file for PDFs. Throws if an image can't be decoded.
export async function prepareScanFile(file: File): Promise<File> {
  if (file.type === 'application/pdf') return file;

  let source: Blob = file;
  if (isHeic(file)) {
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: JPEG_QUALITY });
    source = Array.isArray(converted) ? converted[0]! : converted;
  }

  const img = await loadImage(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvasToJpegFile(canvas, file.name);
}
