import { useState } from "react";
import { isAllowedHighlightImageSrc } from "./isAllowedHighlightImageSrc";
import type { ReleaseNoteHighlight } from "./types";

/** Vite serves frontend/public at `/`, and the desktop build bundles it the
 * same way, so a validated `whats-new/...` src always resolves to `/whats-new/...`. */
function publicImageUrl(src: string): string {
  return `/${src}`;
}

export interface HighlightCardsProps {
  highlights: ReleaseNoteHighlight[];
}

/**
 * The "What's new" headline cards — title, one-sentence summary, and an
 * optional screenshot. Single column at any width (phone-safe). Each image
 * is shown in full, scaled to the card width (`w-full h-auto`, never cropped —
 * release-notes build enforces landscape images) and is also clickable to
 * open a larger lightbox overlay. Images are lazy-loaded.
 */
export function HighlightCards({ highlights }: HighlightCardsProps) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  if (highlights.length === 0) return null;

  return (
    <div className="mb-4" data-testid="whats-new-highlights">
      <div className="grid grid-cols-1 gap-3">
        {highlights.map((highlight, idx) => {
          const image =
            highlight.image && isAllowedHighlightImageSrc(highlight.image.src)
              ? highlight.image
              : undefined;

          return (
            <div
              key={`${highlight.title}-${idx}`}
              data-testid="whats-new-highlight-card"
              className="bg-slate-800 border border-slate-700/50 rounded-xl overflow-hidden"
            >
              {image && (
                <button
                  type="button"
                  onClick={() => setLightbox(image)}
                  aria-label={`View larger image: ${image.alt}`}
                  className="block w-full"
                >
                  <img
                    src={publicImageUrl(image.src)}
                    alt={image.alt}
                    loading="lazy"
                    className="block w-full h-auto"
                  />
                </button>
              )}
              <div className="p-3">
                <h4 className="text-sm font-bold text-white mb-1">{highlight.title}</h4>
                <p className="text-sm text-slate-300">{highlight.summary}</p>
              </div>
            </div>
          );
        })}
      </div>

      {lightbox && (
        <div
          data-testid="whats-new-highlight-lightbox"
          className="fixed inset-0 z-[110] bg-black/85 flex items-center justify-center p-4"
          onMouseDown={() => setLightbox(null)}
        >
          <img
            src={publicImageUrl(lightbox.src)}
            alt={lightbox.alt}
            className="max-w-full max-h-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}

export default HighlightCards;
