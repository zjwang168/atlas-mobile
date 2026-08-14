import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge doesn't know about the custom typography utilities defined in
// tokens.css (display/h2/h3/subheader/body*/caption*/labelTab) — without this,
// e.g. cn('text-base', 'h2') keeps both classes instead of dropping text-base,
// and whichever one lands later in the compiled stylesheet silently wins.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        'display',
        'h2',
        'h3',
        'subheader',
        'body',
        'bodyMedium',
        'bodyEmphasis',
        'bodySmall',
        'bodySmallMedium',
        'bodySmallEmphasis',
        'caption',
        'captionMedium',
        'captionEmphasis',
        'labelTab',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
