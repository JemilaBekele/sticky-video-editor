import { useEffect, useState } from 'react';
import { getServerStatus, type ServerStatus } from '../store/server';

export function useServerStatus(): ServerStatus {
  const [s, setS] = useState<ServerStatus>({ ffmpeg: false, ok: false });
  useEffect(() => { let alive = true; getServerStatus().then(x => { if (alive) setS(x); }); return () => { alive = false; }; }, []);
  return s;
}

export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
