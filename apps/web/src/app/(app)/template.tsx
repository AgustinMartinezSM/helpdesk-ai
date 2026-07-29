/**
 * Remounts on every route change, retriggering the fade-up entrance
 * animation (`.page-enter` in global.css) per navigation.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
