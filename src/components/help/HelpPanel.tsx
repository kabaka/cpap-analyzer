import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { helpArticles, glossaryEntries } from '@/content/help';
import type { HelpArticle, GlossaryEntry } from '@/content/help';
import styles from './HelpPanel.module.css';

interface HelpPanelProps {
  /** Controlled open state */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

type SearchResult =
  | { type: 'article'; item: HelpArticle }
  | { type: 'glossary'; item: GlossaryEntry };

/**
 * Slide-out help drawer with topic tree and search.
 * Opens via `?` key or programmatic control.
 */
export function HelpPanel({ open: controlledOpen, onOpenChange }: HelpPanelProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const isOpen = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  // Keyboard shortcut: ? key opens the help panel
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't trigger when typing in inputs, textareas, or contentEditable
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        setOpen(!isOpen);
      }

      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, setOpen]);

  // Focus search input when panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow animation to start
      const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Trap focus inside panel when open
  useEffect(() => {
    if (!isOpen) return;

    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', handleFocusTrap);
    return () => document.removeEventListener('keydown', handleFocusTrap);
  }, [isOpen]);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path);
      setOpen(false);
    },
    [navigate, setOpen],
  );

  // Filter articles and glossary entries by search query
  const searchResults: SearchResult[] = (() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const results: SearchResult[] = [];

    for (const article of helpArticles) {
      if (
        article.title.toLowerCase().includes(query) ||
        article.summary.toLowerCase().includes(query)
      ) {
        results.push({ type: 'article', item: article });
      }
    }

    for (const entry of glossaryEntries) {
      if (
        entry.term.toLowerCase().includes(query) ||
        entry.quick.toLowerCase().includes(query) ||
        entry.aliases?.some((a) => a.toLowerCase().includes(query))
      ) {
        results.push({ type: 'glossary', item: entry });
      }
    }

    return results;
  })();

  const showSearchResults = searchQuery.trim().length > 0;

  return (
    <>
      {/* Backdrop overlay */}
      {isOpen && <div className={styles.backdrop} onClick={handleClose} aria-hidden="true" />}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`${styles.panel} ${isOpen ? styles.open : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Help panel"
        aria-hidden={!isOpen ? 'true' : undefined}
      >
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Help</h2>
          <button
            type="button"
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Close help panel"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Search */}
        <div className={styles.searchWrapper}>
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="search"
            className={styles.searchInput}
            placeholder="Search help topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search help topics"
          />
        </div>

        {/* Content */}
        <div className={styles.content}>
          {showSearchResults ? (
            <div className={styles.searchResults}>
              <h3 className={styles.sectionTitle}>
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
              </h3>
              {searchResults.length === 0 && (
                <p className={styles.noResults}>No results found. Try a different search term.</p>
              )}
              <ul className={styles.resultList} role="list">
                {searchResults.map((result) => (
                  <li key={result.type === 'article' ? result.item.slug : result.item.id}>
                    <button
                      type="button"
                      className={styles.resultItem}
                      onClick={() =>
                        handleNavigate(
                          result.type === 'article'
                            ? `/help/${result.item.slug}`
                            : `/help/glossary#${result.item.id}`,
                        )
                      }
                    >
                      <span className={styles.resultBadge}>
                        {result.type === 'article' ? 'Guide' : 'Glossary'}
                      </span>
                      <span className={styles.resultTitle}>
                        {result.type === 'article' ? result.item.title : result.item.term}
                      </span>
                      <span className={styles.resultSummary}>
                        {result.type === 'article' ? result.item.summary : result.item.quick}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {/* Topics */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Guides</h3>
                <ul className={styles.topicList} role="list">
                  {helpArticles.map((article) => (
                    <li key={article.slug}>
                      <button
                        type="button"
                        className={styles.topicItem}
                        onClick={() => handleNavigate(`/help/${article.slug}`)}
                      >
                        <ArticleIconComponent icon={article.icon} />
                        <div className={styles.topicInfo}>
                          <span className={styles.topicTitle}>{article.title}</span>
                          <span className={styles.topicSummary}>{article.summary}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Quick links */}
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Quick links</h3>
                <ul className={styles.linkList} role="list">
                  <li>
                    <button
                      type="button"
                      className={styles.linkItem}
                      onClick={() => handleNavigate('/help')}
                    >
                      📚 Help Home
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={styles.linkItem}
                      onClick={() => handleNavigate('/help/glossary')}
                    >
                      📖 Glossary
                    </button>
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <span className={styles.shortcut}>
            Press <kbd className={styles.kbd}>?</kbd> to toggle
          </span>
        </div>
      </div>
    </>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 4L12 12M12 4L4 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className={styles.searchIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArticleIconComponent({ icon }: { icon: string }) {
  const emojiMap: Record<string, string> = {
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
  };

  return (
    <span className={styles.topicIcon} aria-hidden="true">
      {emojiMap[icon] ?? '📄'}
    </span>
  );
}
