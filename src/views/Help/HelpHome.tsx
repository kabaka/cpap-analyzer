import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { helpArticles, guidedTours } from '../../content/help';
import type { HelpArticle } from '../../content/help/articles';
import styles from './HelpHome.module.css';

/** Map article icon type to an emoji for visual identification. */
function iconFor(icon: HelpArticle['icon']): string {
  const map: Record<HelpArticle['icon'], string> = {
    'getting-started': '🚀',
    import: '📂',
    dashboard: '📊',
    sessions: '🌙',
    statistics: '📈',
    events: '⚡',
    pressure: '💨',
    reports: '📄',
    settings: '⚙️',
    clinical: '🏥',
    integrations: '🔗',
  };
  return map[icon];
}

export default function HelpHome() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const normalised = query.trim().toLowerCase();

  const filteredArticles = useMemo(
    () =>
      normalised
        ? helpArticles.filter(
            (a) =>
              a.title.toLowerCase().includes(normalised) ||
              a.summary.toLowerCase().includes(normalised),
          )
        : [...helpArticles],
    [normalised],
  );

  const featured = helpArticles.find((a) => a.featured);
  const nonFeatured = filteredArticles.filter((a) => !a.featured);

  const handleArticleClick = useCallback(
    (slug: string) => {
      navigate(`/help/${slug}`);
    },
    [navigate],
  );

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <h1 className={styles.title}>Help &amp; Documentation</h1>
        <p className={styles.subtitle}>
          Guides, glossary, keyboard shortcuts, and contextual information for CPAP Analyzer.
        </p>
      </header>

      {/* Search */}
      <div className={styles.searchWrapper}>
        <svg
          className={styles.searchIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search help topics…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search help topics"
        />
      </div>

      {/* Featured article (only when not searching) */}
      {!normalised && featured && (
        <div
          className={styles.featured}
          role="link"
          tabIndex={0}
          onClick={() => handleArticleClick(featured.slug)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleArticleClick(featured.slug);
            }
          }}
        >
          <span className={styles.featuredLabel}>Recommended</span>
          <h2 className={styles.featuredTitle}>
            {iconFor(featured.icon)} {featured.title}
          </h2>
          <p className={styles.featuredSummary}>{featured.summary}</p>
        </div>
      )}

      {/* Topic grid */}
      {filteredArticles.length > 0 ? (
        <>
          <h2 className={styles.sectionTitle}>{normalised ? 'Search results' : 'All topics'}</h2>
          <div className={styles.topicGrid}>
            {(normalised ? filteredArticles : nonFeatured).map((article) => (
              <div
                key={article.slug}
                className={styles.topicCard}
                role="link"
                tabIndex={0}
                onClick={() => handleArticleClick(article.slug)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleArticleClick(article.slug);
                  }
                }}
              >
                <span className={styles.topicIcon}>{iconFor(article.icon)}</span>
                <h3 className={styles.topicTitle}>{article.title}</h3>
                <p className={styles.topicSummary}>{article.summary}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.noResults}>
          <p>No topics match &ldquo;{query}&rdquo;. Try a different search term.</p>
        </div>
      )}

      {/* Quick links */}
      {!normalised && (
        <>
          <h2 className={styles.sectionTitle}>Quick links</h2>
          <div className={styles.quickLinks}>
            <button
              className={styles.quickLink}
              type="button"
              onClick={() => navigate('/help/glossary')}
            >
              📖 Glossary
            </button>
            <button
              className={styles.quickLink}
              type="button"
              onClick={() => navigate('/help/keyboard-shortcuts')}
            >
              ⌨️ Keyboard shortcuts
            </button>
          </div>
        </>
      )}

      {/* Guided tours */}
      {!normalised && (
        <>
          <h2 className={styles.sectionTitle}>Guided tours</h2>
          <p className={styles.tourDescription}>
            Guided tours are under development and will be available in a future release.
          </p>
          <div className={styles.tourList}>
            {guidedTours.map((tour) => (
              <div key={tour.id} className={styles.tourCard}>
                <div className={styles.tourInfo}>
                  <h3 className={styles.tourTitle}>{tour.title}</h3>
                  <p className={styles.tourDescription}>{tour.description}</p>
                </div>
                <span className={styles.tourSteps}>{tour.steps.length} steps</span>
                <button className={styles.tourButton} type="button" disabled aria-disabled="true">
                  Coming Soon
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Keyboard hint */}
      <p className={styles.keyboardHint}>
        Press <kbd className={styles.kbd}>?</kbd> anywhere to open the help panel.
      </p>
    </div>
  );
}
