/**
 * Unit tests for help articles — structure and completeness validation.
 *
 * Ensures every article has the required fields, all sections are well-formed,
 * and the collection meets minimum content requirements.
 *
 * @module content/help/__tests__/articles.test
 */

import { describe, it, expect } from 'vitest';
import { helpArticles, articleMap, articleSlugs } from '../articles';
import type { HelpArticle, ArticleIcon } from '../articles';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_ICONS: ArticleIcon[] = [
  'getting-started',
  'import',
  'dashboard',
  'sessions',
  'statistics',
  'events',
  'pressure',
  'reports',
  'settings',
  'clinical',
  'integrations',
];

describe('Help articles', () => {
  describe('helpArticles', () => {
    it('should contain at least 5 articles', () => {
      expect(helpArticles.length).toBeGreaterThanOrEqual(5);
    });

    it('should have unique slugs across all articles', () => {
      const slugs = helpArticles.map((a) => a.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    });

    it.each(helpArticles.map((a) => [a.slug, a] as const))(
      'article "%s" should have all required top-level fields',
      (_slug, article: HelpArticle) => {
        expect(article.slug).toBeTruthy();
        expect(article.title).toBeTruthy();
        expect(article.summary).toBeTruthy();
        expect(article.summary.length).toBeGreaterThan(10);
        expect(VALID_ICONS).toContain(article.icon);
      },
    );

    it.each(helpArticles.map((a) => [a.slug, a] as const))(
      'article "%s" should have at least one section',
      (_slug, article: HelpArticle) => {
        expect(article.sections.length).toBeGreaterThanOrEqual(1);
      },
    );

    it.each(helpArticles.map((a) => [a.slug, a] as const))(
      'article "%s" should have sections with heading and non-empty paragraphs',
      (_slug, article: HelpArticle) => {
        for (const section of article.sections) {
          expect(section.heading).toBeTruthy();
          expect(section.heading.length).toBeGreaterThan(0);
          expect(section.paragraphs.length).toBeGreaterThanOrEqual(1);
          for (const para of section.paragraphs) {
            expect(para.length).toBeGreaterThan(0);
          }
        }
      },
    );

    it('should include key topics', () => {
      const slugs = new Set(helpArticles.map((a) => a.slug));
      expect(slugs.has('getting-started')).toBe(true);
      expect(slugs.has('importing-data')).toBe(true);
      expect(slugs.has('dashboard')).toBe(true);
    });

    it('should have at least one featured article', () => {
      const featured = helpArticles.filter((a) => a.featured === true);
      expect(featured.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('articleMap', () => {
    it('should be a Map with the same size as helpArticles', () => {
      expect(articleMap).toBeInstanceOf(Map);
      expect(articleMap.size).toBe(helpArticles.length);
    });

    it('should map every slug to the correct article', () => {
      for (const article of helpArticles) {
        expect(articleMap.get(article.slug)).toBe(article);
      }
    });

    it('should return undefined for non-existent slugs', () => {
      expect(articleMap.get('non-existent-slug')).toBeUndefined();
    });
  });

  describe('articleSlugs', () => {
    it('should have the same length as helpArticles', () => {
      expect(articleSlugs.length).toBe(helpArticles.length);
    });

    it('should contain all article slugs in order', () => {
      helpArticles.forEach((article, index) => {
        expect(articleSlugs[index]).toBe(article.slug);
      });
    });
  });
});
