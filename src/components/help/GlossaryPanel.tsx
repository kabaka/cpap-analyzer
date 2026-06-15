import { useState, useMemo, useRef, useEffect } from 'react';
import { glossaryEntries, glossaryCategoryOrder, GLOSSARY_CATEGORIES } from '@/content/help';
import type { GlossaryEntry, GlossaryCategory } from '@/content/help';
import { MathEquation } from '@/components/ui/MathEquation';
import styles from './GlossaryPanel.module.css';

interface GlossaryPanelProps {
  /** Optional initial term to scroll to */
  initialTermId?: string;
  /** Show as standalone page (true) or embedded panel (false) */
  standalone?: boolean;
}

type DepthLevel = 'quick' | 'standard' | 'detailed';

const DEPTH_LABELS: Record<DepthLevel, string> = {
  quick: 'Quick',
  standard: 'Standard',
  detailed: 'Detailed',
};

/**
 * Alphabetical, searchable glossary of CPAP and statistics terms.
 * Supports three depth levels per the progressive disclosure model.
 */
export function GlossaryPanel({ initialTermId, standalone = false }: GlossaryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<GlossaryCategory | 'all'>('all');
  const [depthLevel, setDepthLevel] = useState<DepthLevel>('standard');
  const [expandedTermId, setExpandedTermId] = useState<string | null>(initialTermId ?? null);
  const termRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Scroll to initial term on mount
  useEffect(() => {
    if (initialTermId) {
      const el = termRefs.current.get(initialTermId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [initialTermId]);

  // Scroll to hash fragment term
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      setExpandedTermId(hash);
      // Delay to allow render
      const timer = setTimeout(() => {
        const el = termRefs.current.get(hash);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  // Filter entries
  const filteredEntries = useMemo(() => {
    let entries: readonly GlossaryEntry[] = glossaryEntries;

    if (selectedCategory !== 'all') {
      entries = entries.filter((e) => e.category === selectedCategory);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.term.toLowerCase().includes(query) ||
          e.quick.toLowerCase().includes(query) ||
          e.aliases?.some((a) => a.toLowerCase().includes(query)),
      );
    }

    // Sort alphabetically by term
    return [...entries].sort((a, b) => a.term.localeCompare(b.term));
  }, [searchQuery, selectedCategory]);

  // Group entries by first letter
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, GlossaryEntry[]>();

    for (const entry of filteredEntries) {
      const firstChar = entry.term[0] as string | undefined;
      const letter = (firstChar ?? '#').toUpperCase();
      if (!groups.has(letter)) {
        groups.set(letter, []);
      }
      groups.get(letter)?.push(entry);
    }

    return groups;
  }, [filteredEntries]);

  // All available first letters for the alphabet nav
  const availableLetters = useMemo(
    () => Array.from(groupedEntries.keys()).sort(),
    [groupedEntries],
  );

  const handleToggleTerm = (termId: string) => {
    setExpandedTermId((prev) => (prev === termId ? null : termId));
  };

  const getTermContent = (entry: GlossaryEntry): string => {
    switch (depthLevel) {
      case 'quick':
        return entry.quick;
      case 'standard':
        return entry.standard;
      case 'detailed':
        return entry.detailed;
    }
  };

  const containerClass = standalone ? `${styles.container} ${styles.standalone}` : styles.container;

  return (
    <div className={containerClass}>
      {/* Controls */}
      <div className={styles.controls}>
        <div className={styles.searchWrapper}>
          <SearchIcon />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search terms..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search glossary terms"
          />
        </div>

        <div className={styles.filters}>
          {/* Category filter */}
          <div className={styles.filterGroup}>
            <label htmlFor="glossary-category" className={styles.filterLabel}>
              Category
            </label>
            <select
              id="glossary-category"
              className={styles.filterSelect}
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as GlossaryCategory | 'all')}
            >
              <option value="all">All categories</option>
              {glossaryCategoryOrder.map((cat) => (
                <option key={cat} value={cat}>
                  {GLOSSARY_CATEGORIES[cat]}
                </option>
              ))}
            </select>
          </div>

          {/* Depth level */}
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Depth</span>
            <div className={styles.depthToggle} role="radiogroup" aria-label="Explanation depth">
              {(['quick', 'standard', 'detailed'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`${styles.depthButton} ${depthLevel === level ? styles.depthActive : ''}`}
                  role="radio"
                  aria-checked={depthLevel === level ? 'true' : 'false'}
                  onClick={() => setDepthLevel(level)}
                >
                  {DEPTH_LABELS[level]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Alphabet navigation */}
      {availableLetters.length > 0 && (
        <nav className={styles.alphabetNav} aria-label="Alphabet navigation">
          {availableLetters.map((letter) => (
            <a
              key={letter}
              href={`#glossary-${letter}`}
              className={styles.alphabetLink}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(`glossary-${letter}`)
                  ?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              {letter}
            </a>
          ))}
        </nav>
      )}

      {/* Terms */}
      <div className={styles.terms}>
        {filteredEntries.length === 0 && (
          <p className={styles.noResults}>No terms match your search.</p>
        )}

        {availableLetters.map((letter) => (
          <div key={letter} className={styles.letterGroup}>
            <h3 id={`glossary-${letter}`} className={styles.letterHeading}>
              {letter}
            </h3>
            <div className={styles.termList}>
              {groupedEntries.get(letter)?.map((entry) => {
                const isExpanded = expandedTermId === entry.id;
                return (
                  <div
                    key={entry.id}
                    id={entry.id}
                    ref={(el) => {
                      if (el) termRefs.current.set(entry.id, el);
                    }}
                    className={`${styles.termCard} ${isExpanded ? styles.termExpanded : ''}`}
                  >
                    <button
                      type="button"
                      className={styles.termHeader}
                      onClick={() => handleToggleTerm(entry.id)}
                      aria-expanded={isExpanded ? 'true' : 'false'}
                      aria-controls={`glossary-content-${entry.id}`}
                    >
                      <span className={styles.termName}>{entry.term}</span>
                      <span className={styles.termCategory}>
                        {GLOSSARY_CATEGORIES[entry.category]}
                      </span>
                      <ChevronIcon expanded={isExpanded} />
                    </button>

                    {isExpanded && (
                      <div
                        id={`glossary-content-${entry.id}`}
                        className={styles.termContent}
                        role="region"
                        aria-label={`Definition of ${entry.term}`}
                      >
                        <p className={styles.termDefinition}>{getTermContent(entry)}</p>

                        {entry.formula && (
                          <div className={styles.termFormula}>
                            <MathEquation math={entry.formula} display />
                          </div>
                        )}

                        {depthLevel !== 'detailed' && (
                          <div className={styles.depthLinks}>
                            {depthLevel === 'quick' && (
                              <button
                                type="button"
                                className={styles.depthLink}
                                onClick={() => setDepthLevel('standard')}
                              >
                                Show more detail →
                              </button>
                            )}
                            {depthLevel === 'standard' && (
                              <button
                                type="button"
                                className={styles.depthLink}
                                onClick={() => setDepthLevel('detailed')}
                              >
                                Show full explanation →
                              </button>
                            )}
                          </div>
                        )}

                        {entry.aliases && entry.aliases.length > 0 && (
                          <div className={styles.aliases}>
                            <span className={styles.aliasLabel}>Also known as: </span>
                            {entry.aliases.join(', ')}
                          </div>
                        )}

                        {entry.relatedTerms && entry.relatedTerms.length > 0 && (
                          <div className={styles.relatedTerms}>
                            <span className={styles.relatedLabel}>Related: </span>
                            {entry.relatedTerms.map((relId, i) => (
                              <span key={relId}>
                                {i > 0 && ', '}
                                <button
                                  type="button"
                                  className={styles.relatedLink}
                                  onClick={() => {
                                    setExpandedTermId(relId);
                                    const el = termRefs.current.get(relId);
                                    if (el) {
                                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                    }
                                  }}
                                >
                                  {relId}
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        {depthLevel === 'detailed' &&
                          entry.references &&
                          entry.references.length > 0 && (
                            <div
                              className={styles.references}
                              role="region"
                              aria-label={`References for ${entry.term}`}
                            >
                              <span className={styles.referencesLabel}>References</span>
                              <ol className={styles.referencesList}>
                                {entry.references.map((citation, i) => (
                                  <li key={i} className={styles.referenceItem}>
                                    {citation}
                                  </li>
                                ))}
                              </ol>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ''}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
