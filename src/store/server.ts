// ───────────────────────────── Local server status ─────────────────────────────
// The server is optional: it only speeds up MP4 conversion when ffmpeg is installed on the machine.

export interface ServerStatus { ffmpeg: boolean; ok: boolean }

let cached: ServerStatus | null = null;
export async function getServerStatus(force = false): Promise<ServerStatus> {
  if (cached && !force) return cached;
  try {
    const r = await fetch('/api/status', { signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error(String(r.status));
    cached = { ffmpeg: !!(await r.json()).ffmpeg, ok: true };
  } catch {
    cached = { ffmpeg: false, ok: false };
  }
  return cached!;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(blob); });
}
