/**
 * Prepaid recharge card artwork for an item tile. It fills the tile's width
 * and never sets it: the tile's width comes from its grid column, and the
 * fixed aspect ratio keeps every image the same height, whatever its source
 * size.
 */
export function CardArtwork({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      draggable={false}
      className="block w-full max-w-full aspect-[8/5] object-cover rounded-md"
    />
  );
}
