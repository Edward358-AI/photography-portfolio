export const CATEGORIES = ['aviation', 'landscape', 'cityscape', 'nature'] as const;
export type Category = (typeof CATEGORIES)[number];

export const SITE = {
  /** Shown in the header, footer and page titles. */
  name: 'Edward Jiang',
  title: 'Edward Jiang — Photography',
  tagline: 'Aviation, landscape, cityscape & nature photography.',
  description:
    'Photography portfolio of Edward Jiang: aviation, landscape, cityscape and nature work.',
  github: 'Edward358-AI',
  /** Add more socials here and they appear in the footer. */
  socials: [{ label: 'GitHub', href: 'https://github.com/Edward358-AI' }],
  nav: [
    { label: 'Photos', href: '/photos/' },
    { label: 'About', href: '/about/' },
  ],
} as const;

export const CATEGORY_LABELS: Record<Category, string> = {
  aviation: 'Aviation',
  landscape: 'Landscape',
  cityscape: 'Cityscape',
  nature: 'Nature',
};
