import { useRef, useEffect } from 'react';
import styles from './Skeleton.module.css';

type SkeletonVariant = 'text' | 'circle' | 'rect';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: SkeletonVariant;
  className?: string;
}

export function Skeleton({ width, height, variant = 'text', className }: SkeletonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const classNames = [styles.skeleton, styles[variant], className].filter(Boolean).join(' ');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (width !== undefined) {
      el.style.width = typeof width === 'number' ? `${width}px` : width;
    }
    if (height !== undefined) {
      el.style.height = typeof height === 'number' ? `${height}px` : height;
    }
  }, [width, height]);

  return <div ref={ref} className={classNames} role="status" aria-label="Loading" />;
}
