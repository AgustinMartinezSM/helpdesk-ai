/**
 * Remounts on every route change within the public surface, retriggering
 * the fade-up entrance animation (`.page-enter` in global.css).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
