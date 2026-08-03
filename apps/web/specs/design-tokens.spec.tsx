import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The design system's rules, checked against the file that declares them
 * rather than against a rendered page. Every number in `global.css`'s
 * comments is a measurement somebody made once; this makes them measurements
 * the build makes on every run.
 *
 * The rule that shapes this suite: **measure against the adjacent surface,
 * not against the page background.** Sprint 10.0 re-tuned the section bands
 * against `--bg`, passed, and put two bands 0.79 L* apart that render next to
 * each other. A token that is legible on the page and illegible on the well
 * a control sits in is still a defect.
 */

const SRC = join(__dirname, '..', 'src');

const CSS = readFileSync(join(SRC, 'app', 'global.css'), 'utf8');

/** Every stylesheet in the app — global.css plus all 37 CSS modules. */
const STYLESHEETS = (function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? collect(full)
      : entry.endsWith('.css')
        ? [full]
        : [];
  });
})(SRC).map((path) => ({
  relative: path.slice(SRC.length + 1).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

// ---------------------------------------------------------------- parsing

function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector + ' {');
  if (start === -1) {
    throw new Error(`No ${selector} block in global.css`);
  }
  const body = CSS.slice(start, CSS.indexOf('\n}', start));
  const tokens: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const LIGHT = block(':root');
const DARK = block("[data-theme='dark']");

// ------------------------------------------------------------- colour maths

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Resolve a token to a solid colour over a known backdrop. Handles the two
 * shapes the file actually uses — a hex literal, and
 * `color-mix(in srgb, <hex> N%, transparent)` composited over the backdrop —
 * and refuses anything else rather than guessing, so a new syntax fails
 * loudly instead of silently measuring the wrong thing.
 */
function resolve(tokens: Record<string, string>, name: string, over: Rgb): Rgb {
  const raw = tokens[name];
  if (!raw) {
    throw new Error(`Token ${name} is not declared`);
  }
  if (/^#[0-9a-f]{6}$/i.test(raw)) {
    return parseHex(raw);
  }
  const mix = raw.match(
    /^color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+(\d+)%,\s*transparent\)$/i,
  );
  if (mix) {
    const [r, g, b] = parseHex(mix[1]);
    const alpha = Number(mix[2]) / 100;
    return [
      Math.round(r * alpha + over[0] * (1 - alpha)),
      Math.round(g * alpha + over[1] * (1 - alpha)),
      Math.round(b * alpha + over[2] * (1 - alpha)),
    ];
  }
  throw new Error(`Cannot resolve ${name}: ${raw}`);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Perceptual lightness. Section bands are tuned in L*, not in ratio. */
function lstar(c: Rgb): number {
  const y = luminance(c);
  return y <= 216 / 24389 ? (y * 24389) / 27 : Math.pow(y, 1 / 3) * 116 - 16;
}

// ------------------------------------------------------------------- setup

/** Every surface a control or a piece of text can actually land on. */
const SURFACES = [
  '--bg',
  '--surface',
  '--surface-2',
  '--surface-raised',
  '--surface-sunken',
  '--surface-tinted',
] as const;

const THEMES: Array<{ name: string; tokens: Record<string, string> }> = [
  { name: 'light', tokens: LIGHT },
  { name: 'dark', tokens: DARK },
];

function surfacesOf(tokens: Record<string, string>) {
  const page = parseHex(tokens['--bg']);
  return SURFACES.map((name) => ({
    name,
    rgb: resolve(tokens, name, page),
  }));
}

describe('the token file parses, so nothing below passes vacuously', () => {
  it('reads both themes', () => {
    expect(Object.keys(LIGHT).length).toBeGreaterThan(40);
    expect(Object.keys(DARK).length).toBeGreaterThan(20);
  });

  it('declares every colour token a theme overrides in BOTH themes', () => {
    /**
     * A token defined only in light silently keeps its light value in dark,
     * which is how a theme grows a hole nobody sees until a screenshot. Only
     * the families that must differ are checked — shape, motion and spacing
     * are deliberately theme-independent and live in :root alone.
     */
    const mustInvert = [
      '--bg',
      '--surface',
      '--surface-2',
      '--text',
      '--text-secondary',
      '--text-muted',
      '--border',
      '--border-strong',
      '--border-control',
      '--action',
      '--action-hover',
      '--action-on',
      '--action-soft',
      '--focus-ring',
      '--selection',
      '--info',
      '--info-soft',
      '--success',
      '--success-soft',
      '--warning',
      '--warning-soft',
      '--danger',
      '--danger-soft',
      '--surface-raised',
      '--surface-sunken',
      '--surface-tinted',
    ];
    const missing = mustInvert.filter((name) => !DARK[name]);
    expect(missing).toEqual([]);
  });
});

describe('ink acts', () => {
  it.each(THEMES)('$name: the action colour is achromatic', ({ tokens }) => {
    /**
     * This is the whole reason indigo left. The status palette already spends
     * blue, amber, green and red on meaning; an achromatic action colour
     * cannot be mistaken for any of them, at any saturation, by anybody. A
     * chromatic one has to squeeze in beside a state — which is how the old
     * indigo ended up next to the open-blue.
     */
    const [r, g, b] = parseHex(tokens['--action']);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    expect(spread).toBeLessThanOrEqual(12);
  });

  it.each(THEMES)(
    '$name: a label on an action fill clears AA, at rest and on hover',
    ({ tokens }) => {
      const page = parseHex(tokens['--bg']);
      const on = resolve(tokens, '--action-on', page);
      expect(
        contrast(on, resolve(tokens, '--action', page)),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(on, resolve(tokens, '--action-hover', page)),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(THEMES)(
    '$name: the action colour clears AA as text on every surface',
    ({ tokens }) => {
      // Inline links are ink. They are underlined as well, but the colour
      // still has to be readable on the band the paragraph sits in.
      const action = resolve(tokens, '--action', parseHex(tokens['--bg']));
      for (const surface of surfacesOf(tokens)) {
        expect({
          surface: surface.name,
          ratio: Number(contrast(action, surface.rgb).toFixed(2)),
        }).toEqual({
          surface: surface.name,
          ratio: expect.any(Number),
        });
        expect(contrast(action, surface.rgb)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(THEMES)(
    '$name: the focus ring clears 3:1 against every surface it can sit on',
    ({ tokens }) => {
      // WCAG 1.4.11. The offset puts the ring on the background rather than
      // on the control, which is what makes one ring colour per theme enough.
      const ring = resolve(tokens, '--focus-ring', parseHex(tokens['--bg']));
      for (const surface of surfacesOf(tokens)) {
        expect(contrast(ring, surface.rgb)).toBeGreaterThanOrEqual(3);
      }
    },
  );
});

describe('yellow marks, and never says anything', () => {
  it('is the same value in both themes', () => {
    // One value is what lets one mark, one launcher and one set of markers
    // serve both themes instead of forking into a light and a dark identity.
    expect(DARK['--brand']).toBe(LIGHT['--brand']);
    expect(DARK['--brand-on']).toBe(LIGHT['--brand-on']);
  });

  it('fails as text on the light surfaces, which is why the rule exists', () => {
    /**
     * Asserting the FAILURE is the point. If a future palette change made the
     * brand legible as text, the rule against using it as text would quietly
     * become arbitrary, and this test would say so.
     */
    const brand = parseHex(LIGHT['--brand']);
    for (const surface of surfacesOf(LIGHT)) {
      expect(contrast(brand, surface.rgb)).toBeLessThan(3);
    }
  });

  it('carries ink at AA when it becomes a surface', () => {
    const brand = parseHex(LIGHT['--brand']);
    expect(
      contrast(parseHex(LIGHT['--brand-on']), brand),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(parseHex(DARK['--brand-on']), brand),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('always brings its own text colour when it becomes a background', () => {
    /**
     * The defect this catches was found by measuring the rendered page, not
     * by reading CSS: the hero's emphasis span painted a yellow marker
     * behind the heading and inherited the heading's colour, which in the
     * dark theme is near-white. It measured 1.06:1 — the emphasised words
     * were invisible exactly where the emphasis was.
     *
     * So: any rule that sets a brand background must set a colour in the
     * same rule. Inheriting is the bug, because what it inherits differs
     * between themes while the brand does not.
     */
    const offenders: string[] = [];
    for (const sheet of STYLESHEETS) {
      // Split into rule bodies and look at the ones that paint the brand.
      for (const [, body] of sheet.text.matchAll(/\{([^{}]*)\}/g)) {
        const paintsBrand =
          /(?:^|[\s;])background(?:-color)?:\s*var\(\s*--brand\s*[),]/m.test(
            body,
          );
        if (!paintsBrand) continue;
        /**
         * A mark has no text, so it has nothing to make illegible. Two
         * shapes of mark: a pseudo-element with empty content (a dash, a
         * rule, a bullet), and an element given an explicit width AND
         * height with no type set on it — a 2px pulse cannot hold a word.
         */
        const isMark =
          /content:\s*(''|"")/.test(body) ||
          (/(?:^|[\s;])width:/m.test(body) &&
            /(?:^|[\s;])height:/m.test(body) &&
            !/(?:^|[\s;])font-/m.test(body));
        if (isMark) continue;
        if (!/(?:^|[\s;])color:\s*/m.test(body)) {
          offenders.push(`${sheet.relative}: ${body.trim().slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is never assigned to a text colour in any stylesheet', () => {
    /**
     * The measurement above says it must not; this says it does not. A
     * `color: var(--brand)` rule would render 1.12:1 text and no unit test
     * of a component would notice.
     *
     * `--brand-strong` is included because it is barely darker (still under
     * 2:1 as text), and `--brand-soft` and `--brand-glow` because they are
     * washes. `--brand-on` is the one that IS a text colour, and the pattern
     * matches the closing paren so it is not caught by accident — which it
     * was, on the first run of this test.
     */
    const forbidden =
      /(?:^|[^-\w])color:\s*var\(\s*--brand(?:-strong|-soft|-glow)?\s*[),]/gm;
    const offenders = STYLESHEETS.filter((sheet) =>
      forbidden.test(sheet.text),
    ).map((sheet) => sheet.relative);
    expect(offenders).toEqual([]);
  });
});

describe('chroma states', () => {
  it.each(THEMES)(
    '$name: every semantic foreground clears AA on its own soft background',
    ({ tokens }) => {
      const page = parseHex(tokens['--bg']);
      for (const family of ['info', 'success', 'warning', 'danger']) {
        const fg = resolve(tokens, `--${family}`, page);
        const soft = resolve(tokens, `--${family}-soft`, page);
        expect(contrast(fg, soft)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(THEMES)(
    '$name: every semantic foreground clears AA on the card and the page',
    ({ tokens }) => {
      // A banner is not always on its own tint — it can sit on a card.
      const page = parseHex(tokens['--bg']);
      const card = resolve(tokens, '--surface', page);
      for (const family of ['info', 'success', 'warning', 'danger']) {
        const fg = resolve(tokens, `--${family}`, page);
        expect(contrast(fg, page)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, card)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(THEMES)(
    '$name: no semantic colour is achromatic, so none can be read as an action',
    ({ tokens }) => {
      // The mirror of the achromatic-action rule. Together they make the two
      // families separable by construction rather than by taste.
      for (const family of ['info', 'success', 'warning', 'danger']) {
        const [r, g, b] = parseHex(tokens[`--${family}`]);
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(24);
      }
    },
  );
});

describe('neutral content stays readable on the surface it lands on', () => {
  it.each(THEMES)(
    '$name: secondary and muted text clear AA on every surface',
    ({ tokens }) => {
      const page = parseHex(tokens['--bg']);
      for (const name of ['--text', '--text-secondary', '--text-muted']) {
        const fg = resolve(tokens, name, page);
        for (const surface of surfacesOf(tokens)) {
          expect(contrast(fg, surface.rgb)).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(THEMES)(
    '$name: the control border clears 3:1 on every surface',
    ({ tokens }) => {
      // WCAG 1.4.11 again, and the check that caught two of my own candidate
      // values at 2.35:1 while this system was being designed.
      const page = parseHex(tokens['--bg']);
      const border = resolve(tokens, '--border-control', page);
      for (const surface of surfacesOf(tokens)) {
        expect(contrast(border, surface.rgb)).toBeGreaterThanOrEqual(3);
      }
    },
  );
});

describe('section bands are separable where they actually meet', () => {
  /**
   * The landing page's tone SEQUENCE, which is what actually produces the
   * boundaries. `.technical` renders on --surface-sunken and `default`
   * renders the page background, so the pairs are not the ones a reading of
   * the token file suggests.
   *
   * The first version of this test listed the two pairs I EXPECTED and
   * passed while the rendered page carried a 1.9 L* join — the landing puts
   * a default-tone section between the sunken one and the next raised one,
   * and I had not counted it. The browser found it. The list is now derived
   * from the sequence, which is the difference between testing the system
   * and testing my memory of it.
   */
  /**
   * READ FROM THE PAGES, not written down beside them. Sprint 10.1 hard-coded
   * the sequence it believed the landing had and passed while the rendered
   * page carried a join it had not counted; Sprint 10.3 then added a section
   * and changed the sequence, which would have made the hard-coded list stale
   * a second time within two sprints.
   *
   * A `<Section>` with no `tone` prop renders the page background, which is
   * the `default` tone — and forgetting that is precisely how the missed join
   * happened, so it is spelled out here.
   */
  function tonesOf(page: string): string[] {
    const source = readFileSync(
      join(SRC, 'app', '(public)', page, 'page.tsx'),
      'utf8',
    );
    return source
      .split('<Section')
      .slice(1)
      .map((chunk) => {
        const opening = chunk.slice(0, chunk.indexOf('>'));
        return opening.match(/tone="(\w+)"/)?.[1] ?? 'default';
      });
  }

  const PAGES_WITH_BANDS = ['', 'how-it-works', 'features'];

  const TONE_TOKEN: Record<string, string> = {
    default: '--bg',
    raised: '--surface-raised',
    sunken: '--surface-sunken',
    technical: '--surface-sunken', // .technical renders on the sunken level
    tinted: '--surface-tinted',
  };

  /**
   * The joins where lightness cannot do the work, and the --section-border
   * hairline carries the boundary instead. One per theme, both structural:
   * in light, base and raised both sit near white; in dark, base and sunken
   * both sit at the floor of the scale. Naming them is the point — an
   * exception that has to be listed is an exception somebody has to defend.
   */
  const HAIRLINE_CARRIED: Record<string, Array<[string, string]>> = {
    light: [['--bg', '--surface-raised']],
    dark: [['--bg', '--surface-sunken']],
  };

  const key = (a: string, b: string) => [a, b].sort().join('|');

  it('reads a real sequence from the pages, so nothing passes vacuously', () => {
    // Every tone a page uses must be one this test knows how to resolve — a
    // new tone would otherwise be skipped in silence, which is the whole
    // failure mode this suite exists for. /features has a single section and
    // therefore no adjacency; the guard is that the SET is non-trivial.
    const all = PAGES_WITH_BANDS.map(tonesOf);
    for (const tones of all) {
      for (const tone of tones) {
        expect(Object.keys(TONE_TOKEN)).toContain(tone);
      }
    }
    expect(Math.max(...all.map((tones) => tones.length))).toBeGreaterThan(4);
  });

  it.each(THEMES)(
    '$name: every adjacency any page renders clears 3 L*, or is a named hairline join',
    ({ name, tokens }) => {
      const page = parseHex(tokens['--bg']);
      const exempt = HAIRLINE_CARRIED[name].map(([a, b]) => key(a, b));

      const failures: string[] = [];
      for (const route of PAGES_WITH_BANDS) {
        const tones = tonesOf(route);
        for (let i = 1; i < tones.length; i += 1) {
          const a = TONE_TOKEN[tones[i - 1]];
          const b = TONE_TOKEN[tones[i]];
          if (a === b) continue;
          const delta = Math.abs(
            lstar(resolve(tokens, a, page)) - lstar(resolve(tokens, b, page)),
          );
          if (delta >= 3 || exempt.includes(key(a, b))) continue;
          failures.push(`${route || '/'}: ${a}↔${b} = ${delta.toFixed(1)} L*`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it.each(THEMES)(
    '$name: the hairline joins are still as close as their exemption claims',
    ({ name, tokens }) => {
      // If a palette change separated them properly, the exemption should be
      // deleted rather than left standing as folklore.
      const page = parseHex(tokens['--bg']);
      for (const [a, b] of HAIRLINE_CARRIED[name]) {
        const delta = Math.abs(
          lstar(resolve(tokens, a, page)) - lstar(resolve(tokens, b, page)),
        );
        expect({ pair: `${a}↔${b}`, needsTheHairline: delta < 3 }).toEqual({
          pair: `${a}↔${b}`,
          needsTheHairline: true,
        });
      }
    },
  );

  it('keeps light bands lighter than dark bands, so the themes cannot be swapped', () => {
    // A cheap sanity check that a paste into the wrong block gets caught.
    const lightPage = parseHex(LIGHT['--bg']);
    const darkPage = parseHex(DARK['--bg']);
    expect(lstar(lightPage)).toBeGreaterThan(80);
    expect(lstar(darkPage)).toBeLessThan(20);
  });
});

describe('the migration leaves one identity, not two', () => {
  it('has no --accent token left, and no stylesheet reaching for one', () => {
    /**
     * The two-step rename finished in Sprint 10.2. 10.1 aliased the old
     * names to the action family so nothing broke; 10.2 moved every call
     * site to the token that owns its JOB and deleted the aliases.
     *
     * This asserts both halves, because either alone is a trap: a surviving
     * alias invites new code to use the old vocabulary, and a surviving call
     * site would silently resolve to nothing and paint an element
     * `currentColor` — which looks plausible often enough to ship.
     */
    for (const name of Object.keys({ ...LIGHT, ...DARK })) {
      expect({ token: name, isAccent: name.startsWith('--accent') }).toEqual({
        token: name,
        isAccent: false,
      });
    }

    const stragglers = STYLESHEETS.filter((sheet) =>
      /var\(\s*--accent/.test(sheet.text),
    ).map((sheet) => sheet.relative);
    expect(stragglers).toEqual([]);
  });

  it('resolves every custom property a stylesheet asks for', () => {
    /**
     * The general form of the trap above. `var(--typo)` is not an error in
     * CSS — it falls back to the inherited value or to nothing, so a
     * mistyped token is invisible until somebody looks at the pixel.
     *
     * Component-scoped properties are excluded by prefix: a module may
     * define its own (`--lockup-mark`) and a region may re-declare a global
     * one for its subtree, which the inverted-surface block does.
     */
    const declared = new Set([
      ...Object.keys(LIGHT),
      ...Object.keys(DARK),
      // Declared inside [data-surface='inverted'] and in component modules.
      ...[...CSS.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]),
      // Set from JavaScript rather than from CSS, so no stylesheet declares
      // them: the font variable next/font injects, the per-element reveal
      // delay, and the lockup's own scale.
      '--font-sans',
      '--reveal-delay',
      '--lockup-mark',
    ]);

    const unknown = new Set<string>();
    for (const sheet of STYLESHEETS) {
      const localised = new Set(
        [...sheet.text.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]),
      );
      for (const [, name] of sheet.text.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (declared.has(name) || localised.has(name)) continue;
        unknown.add(`${sheet.relative}: ${name}`);
      }
    }
    expect([...unknown]).toEqual([]);
  });

  it('no longer defines the indigo anywhere', () => {
    // The literal values that used to be the product's action colour.
    for (const indigo of [
      '#4f46e5',
      '#4338ca',
      '#818cf8',
      '#a5b4fc',
      '#1e1b4b',
    ]) {
      expect(CSS.toLowerCase()).not.toContain(indigo);
    }
  });
});
