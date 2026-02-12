import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { helpArticles, articleMap } from '../../content/help';
import { GlossaryPanel } from '../../components/help/GlossaryPanel';
import { MathText } from '../../components/ui/MathEquation';
import styles from './HelpArticle.module.css';

/** Generate a URL-friendly anchor id from a heading string. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function HelpArticle() {
  const { topic } = useParams<{ topic: string }>();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<string>('');
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  const isGlossary = topic === 'glossary';
  const article = topic ? articleMap.get(topic) : undefined;

  const articleIndex = useMemo(() => helpArticles.findIndex((a) => a.slug === topic), [topic]);

  const prevArticle = articleIndex > 0 ? helpArticles[articleIndex - 1] : undefined;
  const nextArticle =
    articleIndex >= 0 && articleIndex < helpArticles.length - 1
      ? helpArticles[articleIndex + 1]
      : undefined;

  const sectionIds = useMemo(
    () => (article ? article.sections.map((s) => slugify(s.heading)) : []),
    [article],
  );

  // Intersection observer for active TOC tracking
  useEffect(() => {
    if (!article) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
    );

    const currentRefs = sectionRefs.current;
    for (const el of currentRefs.values()) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [article]);

  const registerSection = useCallback((id: string, el: HTMLElement | null) => {
    if (el) {
      sectionRefs.current.set(id, el);
    } else {
      sectionRefs.current.delete(id);
    }
  }, []);

  const scrollToSection = useCallback((id: string) => {
    const el = sectionRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Special route — render dedicated glossary component
  if (isGlossary) {
    return <GlossaryPanel />;
  }

  // 404 state
  if (!article) {
    return (
      <div className={styles.notFound}>
        <h1 className={styles.notFoundTitle}>Topic not found</h1>
        <p className={styles.notFoundText}>
          The help topic &ldquo;{topic}&rdquo; doesn&apos;t exist.
        </p>
        <button className={styles.notFoundLink} type="button" onClick={() => navigate('/help')}>
          ← Back to Help
        </button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Main content */}
      <article className={styles.content}>
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb} aria-label="Breadcrumb">
          <button className={styles.breadcrumbLink} type="button" onClick={() => navigate('/help')}>
            Help
          </button>
          <span className={styles.breadcrumbSeparator} aria-hidden="true">
            ›
          </span>
          <span className={styles.breadcrumbCurrent}>{article.title}</span>
        </nav>

        <h1 className={styles.title}>{article.title}</h1>
        <p className={styles.summary}>{article.summary}</p>

        {article.sections.map((section, i) => {
          const id = sectionIds[i] ?? '';
          return (
            <section
              key={id}
              className={styles.section}
              ref={(el) => registerSection(id, el)}
              id={id}
            >
              <h2 className={styles.sectionHeading}>{section.heading}</h2>
              {section.paragraphs.map((p, j) => (
                <p key={j} className={styles.paragraph}>
                  <MathText text={p} />
                </p>
              ))}
            </section>
          );
        })}

        {/* Bottom navigation */}
        <nav className={styles.bottomNav} aria-label="Article navigation">
          {prevArticle ? (
            <button
              className={styles.navButton}
              type="button"
              onClick={() => navigate(`/help/${prevArticle.slug}`)}
            >
              ← {prevArticle.title}
            </button>
          ) : (
            <span className={styles.navSpacer} />
          )}
          {nextArticle ? (
            <button
              className={styles.navButton}
              type="button"
              onClick={() => navigate(`/help/${nextArticle.slug}`)}
            >
              {nextArticle.title} →
            </button>
          ) : (
            <span className={styles.navSpacer} />
          )}
        </nav>
      </article>

      {/* Table of contents sidebar */}
      <aside className={styles.sidebar} aria-label="Table of contents">
        <h2 className={styles.tocTitle}>On this page</h2>
        <ol className={styles.tocList}>
          {article.sections.map((section, i) => {
            const id = sectionIds[i] ?? '';
            return (
              <li key={id} className={styles.tocItem}>
                <button
                  className={`${styles.tocLink} ${activeSection === id ? styles.tocLinkActive : ''}`}
                  type="button"
                  onClick={() => scrollToSection(id)}
                >
                  {section.heading}
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
