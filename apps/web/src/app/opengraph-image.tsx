import { ImageResponse } from 'next/og';

/**
 * The social preview. Until Sprint 10.2 every link shared to this project
 * rendered without one — which is the first impression the brand work never
 * reached, and the only place the mark appears off-site.
 *
 * It is generated rather than drawn, for two reasons that matter more than
 * the convenience. A binary in the repository is a second source of truth
 * for the identity, and it goes stale silently: nothing fails when the mark
 * changes and the PNG does not. And an editable source means the geometry
 * here is the SAME geometry as `components/brand/mark.tsx` and `icon.svg`,
 * so a reviewer can diff it.
 *
 * The token values are written out because this renders outside the
 * document and inherits no custom properties. `#ffee8c` is `--brand` and
 * `#1a1a17` is `--brand-on`, identical in both themes — which is why one
 * image serves every context rather than needing a light and a dark variant.
 *
 * The copy is the tagline architecture's descriptor and promise, and
 * deliberately not the brand line: "from signal to resolution" is rare and
 * high-level, and a preview card is where a line gets used most.
 */
export const alt =
  'HelpDesk AI — every request gets a place, an owner and an ending';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: '#faf9f5',
        color: '#1a1a17',
        fontFamily: 'sans-serif',
      }}
    >
      {/* The lockup: the mark's own geometry, at 72px. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <svg width="72" height="72" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill="#ffee8c" />
          <circle cx="8" cy="16" r="3.25" fill="#1a1a17" />
          <rect
            x="13.5"
            y="14.25"
            width="8.5"
            height="3.5"
            rx="1.75"
            fill="#1a1a17"
          />
          <rect
            x="24"
            y="10"
            width="3.5"
            height="12"
            rx="1.75"
            fill="#1a1a17"
          />
        </svg>
        <span
          style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.02em' }}
        >
          HelpDesk AI
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <span
          style={{
            fontSize: 62,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            maxWidth: 900,
          }}
        >
          Every request gets a place, an owner and an ending.
        </span>
        <span style={{ fontSize: 30, color: '#55534c' }}>
          Help desk for internal requests
        </span>
      </div>

      {/* The status line. It travels with every claim, including this one. */}
      <span style={{ fontSize: 24, color: '#6a6860' }}>
        Portfolio project · in active development
      </span>
    </div>,
    size,
  );
}
