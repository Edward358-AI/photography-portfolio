export const CATEGORIES = ['aviation', 'landscape', 'cityscape', 'street', 'nature'] as const;
export type Category = (typeof CATEGORIES)[number];

export const SITE = {
  /** Shown in the header, footer and page titles. */
  name: 'Chengyao Jiang',
  title: 'Chengyao Jiang — Photography',
  tagline: 'Aviation, landscape, cityscape, street & nature photography.',
  description:
    'Photography portfolio of Chengyao Jiang: aviation, landscape, cityscape, street and nature work.',
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
  street: 'Street',
  nature: 'Nature',
};
