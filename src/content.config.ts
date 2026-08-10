import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { CATEGORIES } from './site.config';

/**
 * Photo entries are machine-generated JSON — one file per photo, written by
 * `npm run ingest` (scripts/ingest/index.mjs). Hand-edit title/alt/location/tags
 * freely; the ingest script never rewrites an existing entry unless --force.
 */
const photos = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/photos' }),
  schema: z.object({
    title: z.string(),
    alt: z.string(),
    date: z.coerce.date(),
    category: z.enum(CATEGORIES),
    featured: z.boolean().default(false),
    image: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      /** Tiny blurred WebP as a data: URI — zero-JS blur-up placeholder. */
      lqip: z.string(),
      variants: z
        .array(
          z.object({
            width: z.number().int().positive(),
            avif: z.string(),
            webp: z.string(),
          }),
        )
        .nonempty(),
    }),
    exif: z
      .object({
        camera: z.string().optional(),
        lens: z.string().optional(),
        focalLength: z.string().optional(),
        aperture: z.string().optional(),
        shutterSpeed: z.string().optional(),
        iso: z.number().int().optional(),
      })
      .optional(),
    location: z.string().optional(),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { photos };
