export const CATEGORIES = ['aviation', 'landscape', 'cityscape', 'nature'] as const;
export type Category = (typeof CATEGORIES)[number];

export const SITE = {
  /** Shown in the header, footer and page titles. */
  name: 'Edward Jiang',
  title: 'Edward Jiang — Photography',
  tagline: 'Aviation, landscape, cityscape & nature photography — and the software I build.',
  description:
    'Photography portfolio of Edward Jiang: aviation, landscape, cityscape and nature work, plus software project write-ups.',
  github: 'Edward358-AI',
  /** Add more socials here and they appear in the footer. */
  socials: [{ label: 'GitHub', href: 'https://github.com/Edward358-AI' }],
  nav: [
    { label: 'Photos', href: '/photos/' },
    { label: 'Projects', href: '/projects/' },
    { label: 'About', href: '/about/' },
  ],
} as const;

export const CATEGORY_LABELS: Record<Category, string> = {
  aviation: 'Aviation',
  landscape: 'Landscape',
  cityscape: 'Cityscape',
  nature: 'Nature',
};
