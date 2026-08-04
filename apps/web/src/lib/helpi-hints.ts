/**
 * Helpi's hints — the single source of truth for what the guide says.
 *
 * Helpi is a written guide, not a chatbot and not AI. Every string here is
 * authored by hand and selected by route; nothing is generated. That is a
 * hard constraint, not a style choice, and the reason is structural: because
 * nothing is generated, a companion that behaved (or read) like an AI
 * assistant would promise a kind of answer nothing behind it can produce.
 *
 * The old wording rested this on "the whole public site states that AI
 * assistance is planned", which had been false since Sprint 9.0 — four AI
 * capabilities are built and reachable. Resting a hard constraint on a
 * status that moves is how a constraint quietly stops applying.
 *
 * WHY THIS FILE IS IN SPANISH AND THE REST OF THE PRODUCT IS NOT.
 * es-AR is the product's primary language (Sprint 10.1's owner decision) and
 * full internationalization is Sprint 10.9. Translating the whole product
 * ahead of the machinery that would keep two languages in step is how a
 * half-translated interface happens. Helpi moves first because it is the
 * product's voice in its most concentrated form, it is one file, and its
 * specs guard it — so it is the cheapest place to find out what the voice
 * actually sounds like before committing every screen to it.
 *
 * Rules for adding a hint:
 * - One or two short sentences, second person, under ~90 characters.
 *   Spanish runs longer than English; the budget did not move, so cut.
 * - Voseo, naturally: contá, pegá, invitá, fijate. Never tuteo, never
 *   vosotros, never "usted". Register stays professional — voseo is how
 *   people here speak, not slang.
 * - Never promise a capability `product-status.ts` marks below `available`.
 * - Never invite conversation ("preguntame", "chateá conmigo") — Helpi
 *   cannot answer, in either language.
 */

export interface HelpiHint {
  /** One or two short sentences shown in the panel. */
  message: string;
  /** Optional in-product link, when there is an obvious next step. */
  action?: { href: string; label: string };
}

export const HELPI_INTRO = 'Soy Helpi. Te muestro cómo funciona HelpDesk AI.';

/** Shown under every hint so Helpi never gets mistaken for a chatbot. */
export const HELPI_DISCLAIMER = 'Ayudas escritas y breves — no es un chat.';

const HINTS: Record<string, HelpiHint> = {
  '/': {
    message: HELPI_INTRO,
    action: { href: '/how-it-works', label: 'Empezá por acá' },
  },
  '/how-it-works': {
    message: 'Un ticket es un pedido de ayuda que queda ordenado.',
  },
  '/features': {
    message: 'Cada cosa de esta lista dice qué funciona hoy.',
    action: { href: '/how-it-works', label: 'Verlo en la práctica' },
  },
  '/security': {
    message: 'Son decisiones de ingeniería reales, no certificaciones.',
  },
  '/engineering': {
    message: 'Acá está cómo se construyó el sistema, por dentro.',
  },
  '/about': {
    // Helpi's "I" is always Helpi. On this page the first person belongs to
    // the author, so Helpi points at him instead of speaking as him.
    message: 'Acá te cuenta por qué lo hizo, con sus palabras.',
  },
  '/contact': {
    message: 'Este formulario prepara un mensaje: no lo envía.',
  },
  '/login': {
    message: 'Desde acá entrás. Si la máquina es compartida, marcalo.',
  },

  // Authenticated app. These hints are shorter and fewer on purpose:
  // someone already working does not need to be taught the product, only
  // pointed at a control they may not have noticed.
  '/tickets': {
    message: 'Usá los filtros para encontrar un pedido más rápido.',
    action: { href: '/tickets/new', label: 'O abrí un pedido nuevo' },
  },
  '/tickets/new': {
    message:
      'Contá el problema con tus palabras. La prioridad ayuda a ordenar.',
  },
  '/account': {
    message: 'Tus permisos deciden qué podés hacer en la plataforma.',
  },
  '/organization/new': {
    // Said the name could not be changed until Sprint 10.5 built the rename.
    // What stays fixed is the internal key derived from it, which is a
    // different promise and a smaller one.
    message: 'Ponele un nombre: después lo podés cambiar. Quedás como titular.',
  },
  '/organization': {
    // The route that used to fall through to the public intro. See hintFor.
    message: 'Acá definís el nombre, las sucursales y los equipos de soporte.',
  },
  '/people': {
    message:
      'Invitá a alguien y pasale el código vos: no lo mandamos por mail.',
  },
  '/join': {
    message: 'Pegá el código que te dieron. Vas a ver quién te invitó.',
  },
};

/** Ticket detail lives at /tickets/<id>, so it needs a pattern. */
const TICKET_DETAIL_HINT: HelpiHint = {
  // "AI drafts for staff" was here in the present tense for a capability
  // that needs provider credentials no deployment has supplied. The panel
  // itself says when no model is connected; the hint stops promising it.
  message: 'Acá queda todo: respuestas, estado e historial del pedido.',
};

/**
 * Every authenticated route prefix. A path under one of these that has no
 * hint gets SILENCE, because guessing inside a tool somebody is working in
 * is worse than staying quiet.
 *
 * `/organization` was missing from this list, so it fell through to the
 * public marketing intro — an administrator configuring branches was offered
 * "let me show you how HelpDesk AI works" and a link off to the public site.
 * The list is exported so the specs can assert that every authenticated
 * route in the app is covered by it, which is what stops the next route from
 * repeating this.
 */
export const APP_ROUTE_PREFIXES = [
  '/tickets',
  '/account',
  '/people',
  '/join',
  '/organization',
] as const;

/**
 * The hint for a route, or null when Helpi has nothing useful to add.
 * Unknown PUBLIC routes fall back to the intro rather than showing nothing,
 * so a new marketing page never leaves the guide silently broken.
 */
export function hintFor(pathname: string): HelpiHint | null {
  const exact = HINTS[pathname];
  if (exact) {
    return exact;
  }
  // /tickets/<id> — checked after the exact table so /tickets/new wins.
  if (/^\/tickets\/[^/]+$/.test(pathname)) {
    return TICKET_DETAIL_HINT;
  }
  if (APP_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }
  return HINTS['/'];
}
