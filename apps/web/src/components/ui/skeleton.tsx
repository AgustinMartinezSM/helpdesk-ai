import styles from './skeleton.module.css';

export interface SkeletonProps {
  width?: string;
  height?: string;
  className?: string;
}

/**
 * Shimmer placeholder block. Wrap a group of skeletons in an element with
 * `role="status"` + `aria-label` so assistive tech announces the loading.
 */
export function Skeleton({ width, height = '1rem', className }: SkeletonProps) {
  return (
    <span
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
