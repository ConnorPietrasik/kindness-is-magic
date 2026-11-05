import type { ReactNode } from "react";

interface HelpImageProps {
  /** Vite-imported image source (committed screenshots live in src/assets/help/). */
  src: string;
  alt: string;
  caption?: ReactNode;
  /**
   * Intrinsic capture dimensions. Every guide screenshot is a 1440-wide
   * viewport capture, 1000 tall by default (the e2e capture config); pass the
   * real height for the rare exception. The attributes reserve the image's
   * space before the lazy load completes, so the page height is stable and
   * TOC anchor jumps land on the right section instead of drifting as
   * images load. `w-full` scales the rendered size; the attributes only
   * set the aspect ratio.
   */
  width?: number;
  height?: number;
}

/**
 * HelpImage — a guide screenshot in a bordered figure with an optional
 * caption. Shared by every help page so image styling is consistent.
 */
export function HelpImage({ src, alt, caption, width = 1440, height = 1000 }: HelpImageProps) {
  return (
    <figure className="my-4">
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading="lazy"
        className="w-full rounded-lg border border-gray-200 bg-white shadow-sm"
      />
      {caption != null && <figcaption className="mt-2 text-sm text-gray-500">{caption}</figcaption>}
    </figure>
  );
}
