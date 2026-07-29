import type { HTMLAttributes } from 'react';
import styles from './card.module.css';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Hover elevation — only for cards that are (inside) a link or button. */
  interactive?: boolean;
}

export function Card({ interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={[styles.card, interactive ? styles.interactive : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  );
}
