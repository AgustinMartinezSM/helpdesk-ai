import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAPABILITY_AREAS,
  CAPABILITY_STATUS_LABELS,
} from '../src/lib/product-status';

/**
 * ADR 0009 says no page hard-codes a capability status. It said that from
 * the day it was written, and seven pages did it anyway — three `StatusPill`
 * literals on how-it-works, two prose claims and a workflow heading on the
 * landing, the root metadata description, and the hero visual. Four of the
 * seven had gone stale by the time Sprint 10.0 found them, which is exactly
 * the failure the ADR exists to prevent.
 *
 * The rule was never enforced because it lived in a decision record. It
 * lives here now. This suite reads the source rather than the DOM, because
 * the defect is a literal in the source: a page rendering the right label
 * today by coincidence still fails the moment the module changes.
 */

const SRC = join(__dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((path) => ({
  path,
  // Normalised for matching, and kept relative so a failure names something
  // a person can open.
  relative: path.slice(SRC.length + 1).replace(/\\/g, '/'),
  text: readFileSync(path, 'utf8'),
}));

describe('capability status is never written by hand', () => {
  it('finds the source tree, so an empty pass is impossible', () => {
    // Without this, a broken path would make every assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(40);
    expect(FILES.some((f) => f.relative === 'lib/product-status.ts')).toBe(
      true,
    );
  });

  it('never passes a literal status to StatusPill', () => {
    /**
     * `status="api-ready"` is the defect in its purest form. The two files
     * below are allowed because neither is claiming a capability's status:
     * the features page renders one of each to DEFINE the vocabulary, and
     * the security page labels the security roadmap, which is not a
     * `product-status.ts` capability at all.
     */
    const allowed = new Set([
      'app/(public)/features/page.tsx',
      'app/(public)/security/page.tsx',
    ]);

    const offenders = FILES.filter(
      (file) =>
        !allowed.has(file.relative) &&
        /<StatusPill\s+status=(["'])/.test(file.text),
    ).map((file) => file.relative);

    expect(offenders).toEqual([]);
  });

  it('never writes a status label as a bare string outside the module that defines it', () => {
    /**
     * Only the distinctive labels are checked. "Available" and "Planned" are
     * ordinary English words that appear in honest prose ("planned for a
     * later sprint"), and forbidding them would buy a false positive a
     * sprint. "API ready" and "In development" are this project's own
     * vocabulary, so anywhere they appear as a literal, somebody typed a
     * status instead of rendering one.
     *
     * The match is textual, so it trips on a comment that quotes a label
     * too. That is the deliberate trade: a check that parses could be
     * argued with, and this one cannot. Write about a status without
     * spelling it out.
     */
    const distinctive = [
      CAPABILITY_STATUS_LABELS['api-ready'],
      CAPABILITY_STATUS_LABELS['in-development'],
    ];

    const allowed = new Set([
      'lib/product-status.ts',
      'app/(public)/features/page.tsx',
    ]);

    const offenders = FILES.filter(
      (file) =>
        !allowed.has(file.relative) &&
        distinctive.some((label) => file.text.includes(label)),
    ).map((file) => file.relative);

    expect(offenders).toEqual([]);
  });

  it('keeps every capability name unique, because pages look them up by name', () => {
    // `capability(area, name)` throws on a miss, so a duplicate would make
    // the lookup ambiguous and a rename would break the build — which is
    // the intended behaviour, but only while names identify one thing.
    const names = CAPABILITY_AREAS.flatMap((area) =>
      area.capabilities.map((entry) => `${area.key}/${entry.name}`),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every api-ready capability a note saying what is missing', () => {
    // ADR 0009: "Code existing has never been enough to earn `available`,
    // and now it is not enough to earn `api-ready` either — the note has to
    // say what is missing."
    const withoutNote = CAPABILITY_AREAS.flatMap((area) =>
      area.capabilities
        .filter((entry) => entry.status === 'api-ready' && !entry.note?.trim())
        .map((entry) => `${area.key}/${entry.name}`),
    );
    expect(withoutNote).toEqual([]);
  });
});

/** Every page and component — the surfaces a person actually reads. */
const publicAndApp = FILES.filter(
  (file) =>
    file.relative.startsWith('app/') || file.relative.startsWith('components/'),
);

describe('the product does not claim what it cannot do', () => {
  it('never says an invitation was sent', () => {
    /**
     * ADR 0008 left adopting an email provider to the project owner and it
     * has not happened, so the platform sends nothing. The copy says so in
     * three places; this makes sure no fourth place ever says otherwise.
     */
    const offenders = publicAndApp
      .filter((file) =>
        /\b(we|it|the platform)\s+(will\s+)?(email|send)s?\s+(you|them|the code|an invitation)/i.test(
          file.text,
        ),
      )
      .map((file) => file.relative);

    expect(offenders).toEqual([]);
  });

  it('never promises routing happens automatically', () => {
    // Routing is a person placing a ticket into a support team. Automatic
    // rules are a later sprint and must not be pre-announced.
    const offenders = publicAndApp
      .filter((file) =>
        /automatic(ally)?\s+(routes?|routing|assigns?|triages?)/i.test(
          file.text,
        ),
      )
      .map((file) => file.relative);

    expect(offenders).toEqual([]);
  });

  it('keeps a support team distinct from a department', () => {
    /**
     * ADR 0022, and the mistake its first draft made. A department is where
     * a requester works and belongs to exactly one branch; a support team
     * resolves tickets and is owned by the organization. Any copy that
     * calls one the other recreates the error the project owner caught.
     */
    const offenders = publicAndApp
      .filter((file) =>
        /department\s+(that\s+)?(resolves?|fixes|handles the ticket)|route\s+(it\s+)?to\s+(a|the)\s+department/i.test(
          file.text,
        ),
      )
      .map((file) => file.relative);

    expect(offenders).toEqual([]);
  });
});

describe('the public site teaches the product its own shape', () => {
  /**
   * Until Sprint 10.3 a visitor could not learn from this site that the
   * product is multi-tenant. "Department" and "service point" appeared in no
   * public prose at all, and "branch" only in a technical listing — so the
   * thing the brand calls its first differentiator was invisible.
   */
  const HOW_IT_WORKS = FILES.find(
    (file) => file.relative === 'app/(public)/how-it-works/page.tsx',
  );

  it('finds the page that teaches the vocabulary', () => {
    expect(HOW_IT_WORKS).toBeDefined();
  });

  it('names every structural concept in plain prose', () => {
    const text = HOW_IT_WORKS?.text ?? '';
    for (const term of [
      'Organization',
      'Branch',
      'Department',
      'Service point',
      'Support team',
    ]) {
      expect({ term, taught: text.includes(term) }).toEqual({
        term,
        taught: true,
      });
    }
  });

  it('states that a department is not a support team', () => {
    /**
     * ADR 0022's first draft merged the two concepts, the project owner
     * caught it, and the ADR keeps its misleading filename so the correction
     * stays visible. The product says the distinction on the Organization
     * screen; this is the public half of the same sentence, and it is the
     * one line most likely to stop somebody modelling their company wrong.
     */
    // Whitespace-tolerant: this is source, and the formatter decides where
    // the sentence breaks. Matching a literal space would make the test fail
    // the next time a word is added earlier in the paragraph.
    const text = (HOW_IT_WORKS?.text ?? '').replace(/\s+/g, ' ');
    expect(text).toMatch(/A department is not a support team/i);
    expect(text).toMatch(
      /department says where somebody works.*support team says what they fix/i,
    );
  });

  it('never says a support team belongs to a branch', () => {
    // It is organization-owned; its branch reach is an explicit join where
    // no rows means organization-wide (ADR 0022). "The branch's support
    // team" would recreate exactly the merged model.
    const offenders = publicAndApp
      .filter((file) =>
        /support team (of|for|in|belonging to) (a|the|each|its) branch|branch'?s support team/i.test(
          file.text,
        ),
      )
      .map((file) => file.relative);
    expect(offenders).toEqual([]);
  });

  it('uses no term from the strategy rejected list', () => {
    /**
     * The vocabulary was clean when Sprint 10.3 swept it, and a sweep is
     * only worth as much as its repetition. Terms that describe things this
     * product does not have are the dangerous half: they are the ones a
     * plausible sentence reaches for.
     */
    const rejected =
      /enterprise-grade|world-class|revolutionary|cutting-edge|next-generation|best-in-class|production-ready|streamline|empower|supercharge|transform your workflow|effortless|seamless|AI-powered|powered by AI|AI-driven|automatically resolves|self-healing|escalation polic|workflow automation|routing rules|24\/7|\bend users?\b/i;

    const offenders = publicAndApp
      .filter((file) => rejected.test(file.text))
      .map((file) => file.relative);
    expect(offenders).toEqual([]);
  });
});
