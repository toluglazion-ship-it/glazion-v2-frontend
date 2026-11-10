import { useState } from 'react';

/** A photo with a shorter long edge than this is low resolution (the imported library is mostly 113 px). */
const LOW_RES = 400;
/** Shown at most this many times its own size: past that, enlarging only adds blur. */
const MAX_ZOOM = 2;

interface Props {
  src: string;
  alt: string;
  onError?: () => void;
  loading?: 'lazy';
  /** Large views say when a photo is low resolution; small cards don't need to. */
  flagLowRes?: boolean;
}

/** A result's photo, filling its box unless that would blow a small photo up past twice its size. */
export default function TilePhoto({ src, alt, onError, loading, flagLowRes }: Props) {
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  // The sample data draws its tiles as SVG, which has no resolution to speak of.
  const small = !!natural && !src.startsWith('data:image/svg') && Math.max(natural.width, natural.height) < LOW_RES;
  return (
    <>
      <img
        src={src}
        alt={alt}
        loading={loading}
        onError={onError}
        onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
        style={small ? { maxWidth: natural.width * MAX_ZOOM, maxHeight: natural.height * MAX_ZOOM } : undefined}
      />
      {flagLowRes && small && <span className="photo-note">Low-resolution photo</span>}
    </>
  );
}
