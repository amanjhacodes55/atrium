import { disposition } from "./http";

// Types the browser may render inline. Everything else (HTML and SVG included, which could run
// script on this origin) is sent as a download.
const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/[a-z0-9.+-]+|application\/pdf|text\/plain)$/;

export function fileResponse(request: Request, name: string, mime: string, bytes: Buffer) {
  const download = new URL(request.url).searchParams.has("download") || !INLINE.test(mime);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": INLINE.test(mime) ? mime : "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": disposition(download ? "attachment" : "inline", name),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=60",
    },
  });
}
