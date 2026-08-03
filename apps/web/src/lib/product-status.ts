/**
 * Single source of truth for the public site's capability and project
 * status. Every status here must be derivable from the repository —
 * the public site must never present planned work as available.
 *
 * - `available`     usable end-to-end in the product UI today
 * - `api-ready`     implemented behind the gateway, but not usable by
 *                   default: it still needs a product UI, or configuration
 *                   a deployment has to supply for itself
 * - `in-development` actively being built in the current sprint
 * - `planned`       on the roadmap, not started
 *
 * `api-ready` covers two shapes of "built but not turned on" (ADR 0009):
 * assignment has an API and no picker UI yet, while the AI capabilities have
 * both an API and a UI but need provider credentials per deployment. Code
 * existing is never enough on its own to earn `available`.
 */

export type CapabilityStatus =
  'available' | 'api-ready' | 'in-development' | 'planned';

export const CAPABILITY_STATUS_LABELS: Record<CapabilityStatus, string> = {
  available: 'Available',
  'api-ready': 'API ready',
  'in-development': 'In development',
  planned: 'Planned',
};

export interface Capability {
  name: string;
  description: string;
  status: CapabilityStatus;
  note?: string;
}

export interface CapabilityArea {
  key: string;
  title: string;
  description: string;
  capabilities: Capability[];
}

export const CAPABILITY_AREAS: CapabilityArea[] = [
  {
    key: 'support-operations',
    title: 'Support operations',
    description:
      'The core of the product: a ticket lifecycle with explicit, audited transitions.',
    capabilities: [
      {
        name: 'Ticket lifecycle',
        description:
          'Create, start progress, resolve, reopen and close — every transition is explicit and validated by the domain.',
        status: 'available',
      },
      {
        name: 'Priorities',
        description:
          'Low to urgent, chosen at creation and visible across the product.',
        status: 'available',
      },
      {
        name: 'Comments',
        description:
          'Conversation threads on every ticket, for requesters and staff.',
        status: 'available',
      },
      {
        name: 'Internal notes',
        description:
          'Staff-only notes, clearly labeled and never shown to requesters.',
        status: 'available',
      },
      {
        name: 'Ticket history',
        description:
          'Every action on a ticket is recorded and displayed as a timeline.',
        status: 'available',
      },
      {
        name: 'Assignments',
        description: 'Route each ticket to the technician who owns it.',
        status: 'api-ready',
        note: 'The tickets API supports assignment; the assignee picker UI is planned.',
      },
      {
        name: 'Categories',
        description:
          'Organize tickets by area — designed to pair with AI classification.',
        status: 'planned',
        note: 'The data model reserves a category per ticket.',
      },
      {
        name: 'Attachments',
        description: 'Files and screenshots attached to tickets and comments.',
        status: 'planned',
      },
    ],
  },
  {
    key: 'ai-assistance',
    title: 'AI assistance',
    description:
      'AI as an assistant, never an authority: suggestions are reviewed by people, and every final action stays human. Gemini provider integration is implemented and verified locally. Each deployment must configure its own provider credentials before enabling these capabilities; without them the service answers from a deterministic local provider that connects to nothing.',
    capabilities: [
      {
        name: 'Summarization',
        description:
          'Condense long ticket threads into a short, factual summary.',
        status: 'api-ready',
        note: 'Shown in a staff-only panel on the ticket, labeled with the provider and model that produced it.',
      },
      {
        name: 'Classification',
        description: 'Suggest a category the moment a ticket arrives.',
        status: 'api-ready',
        note: 'Suggests from a fixed category list. Applying it to the ticket is still a manual step.',
      },
      {
        name: 'Priority suggestion',
        description:
          'Estimate urgency from the request so triage starts pre-sorted.',
        status: 'api-ready',
        note: 'Suggests a priority for a technician to accept or ignore; it never changes the ticket.',
      },
      {
        name: 'Suggested replies',
        description:
          'Draft a first response for the technician to review, edit and send.',
        status: 'api-ready',
        note: 'The draft is shown to staff only, and it is sent by a person or not at all.',
      },
      {
        name: 'Duplicate detection',
        description: 'Surface similar open tickets before work is done twice.',
        status: 'planned',
        note: 'Needs text embeddings and similarity search, which the platform does not have yet.',
      },
    ],
  },
  {
    key: 'collaboration',
    title: 'Collaboration',
    description:
      'Clear roles and clear ownership: everyone sees exactly what their role needs.',
    capabilities: [
      {
        name: 'Role-based access',
        description:
          'Every action is checked against a permission the role carries, on the server, in every service.',
        status: 'available',
      },
      {
        name: 'Invitations',
        description:
          'Invite a colleague with the role they should have; they create their own account to accept.',
        status: 'available',
        note: 'The platform sends no email — the administrator passes the one-time code on themselves.',
      },
      {
        name: 'People directory',
        description:
          'See who is in your organization and which role each person holds.',
        status: 'available',
      },
      {
        name: 'Member administration',
        description:
          'Change the role of somebody already here, suspend them, remove them, or bring them back.',
        status: 'available',
        note: 'A change takes effect the next time the person signs in or their session refreshes, within fifteen minutes. Nobody can administer their own membership, so an organization always keeps an administrator.',
      },
      {
        name: 'Branch assignment',
        description:
          'Give a branch manager the branches they are responsible for, and see who covers what.',
        status: 'available',
      },
      {
        name: 'Organization setup',
        description:
          'Register the branches you work from, their departments and their service points, and archive what closed.',
        status: 'available',
        note: 'Archiving a branch keeps everything inside it, so reopening restores the branch exactly as it was.',
      },
      {
        name: 'Ticket ownership',
        description:
          'Requesters keep control of their tickets — including the final "confirm fix and close".',
        status: 'available',
      },
      {
        name: 'Comment threads',
        description: 'Public conversation plus staff-only internal notes.',
        status: 'available',
      },
      {
        name: 'Notifications',
        description:
          'In-app notifications when a ticket you care about changes.',
        status: 'api-ready',
        note: 'The notification service is live behind the gateway; the product UI is planned.',
      },
    ],
  },
  {
    key: 'security-governance',
    title: 'Security and governance',
    description:
      'Security is a product requirement, not an afterthought — see the Security page for the full picture.',
    capabilities: [
      {
        name: 'Authentication',
        description:
          'argon2id password hashing, short-lived access tokens and refresh token rotation.',
        status: 'available',
      },
      {
        name: 'Authorization',
        description:
          'Role guards on every protected endpoint of every domain service — the gateway routes, the services decide.',
        status: 'available',
      },
      {
        name: 'Auditability',
        description:
          'An immutable audit service records every domain event, admin-only by design.',
        status: 'api-ready',
        note: 'Audit trail API is live; the browsing UI is planned.',
      },
      {
        name: 'Input validation',
        description:
          'Every request body is validated against explicit DTOs before it reaches the domain.',
        status: 'available',
      },
      {
        name: 'Service isolation',
        description:
          'Each service owns its database — no shared tables, no cross-service queries.',
        status: 'available',
      },
      {
        name: 'Safe error handling',
        description:
          'Domain errors map to safe responses; internals are never leaked to clients.',
        status: 'available',
      },
    ],
  },
  {
    key: 'analytics-observability',
    title: 'Analytics and observability',
    description:
      'Operational truth for managers and operators, projected from the event stream.',
    capabilities: [
      {
        name: 'Ticket metrics',
        description:
          'Volumes, statuses and resolution snapshots projected per ticket.',
        status: 'api-ready',
        note: 'Staff-only summary API is live; dashboards are planned.',
      },
      {
        name: 'Dashboards',
        description: 'Visual operational dashboards for team managers.',
        status: 'planned',
      },
      {
        name: 'Structured logs',
        description: 'Consistent, structured logging across every service.',
        status: 'available',
      },
      {
        name: 'Request correlation',
        description:
          'A correlation id follows each request across service boundaries.',
        status: 'available',
      },
      {
        name: 'Service health',
        description: 'Health endpoints on every service in the platform.',
        status: 'available',
      },
    ],
  },
];

/** Curated subset shown on the landing page capability grid. */
export const LANDING_CAPABILITIES: Capability[] = [
  pick('support-operations', 'Ticket lifecycle'),
  pick('collaboration', 'Role-based access'),
  pick('support-operations', 'Internal notes'),
  pick('support-operations', 'Ticket history'),
  pick('ai-assistance', 'Summarization'),
  pick('ai-assistance', 'Classification'),
  pick('ai-assistance', 'Priority suggestion'),
  pick('ai-assistance', 'Suggested replies'),
  pick('ai-assistance', 'Duplicate detection'),
  pick('collaboration', 'Notifications'),
  pick('analytics-observability', 'Ticket metrics'),
  pick('security-governance', 'Auditability'),
];

function pick(areaKey: string, name: string): Capability {
  const area = CAPABILITY_AREAS.find((entry) => entry.key === areaKey);
  const capability = area?.capabilities.find((entry) => entry.name === name);
  if (!capability) {
    throw new Error(`Unknown capability: ${areaKey}/${name}`);
  }
  return capability;
}

export interface ProjectStatusGroup {
  /**
   * A group is omitted entirely when it has nothing in it, rather than
   * rendering a heading over an empty list. Nothing sits in development
   * between sprints, so "In development" is absent more often than not.
   */
  title: 'Implemented' | 'In development' | 'Planned';
  items: string[];
}

/** Honest project status, kept in sync with docs/progress. */
export const PROJECT_STATUS: ProjectStatusGroup[] = [
  {
    title: 'Implemented',
    items: [
      'Authentication with refresh token rotation',
      'Ticket lifecycle, comments and internal notes',
      'Event-driven platform: audit, notifications and analytics services',
      'API gateway and web BFF with an httpOnly session cookie',
      'Design system, dark mode and accessible product UI',
      'Public product experience — this site',
      'AI service: summaries, classification, priorities and reply drafts behind a provider port, with a deterministic local provider and Google Gemini',
    ],
  },
  {
    title: 'Planned',
    items: [
      'Duplicate detection, which needs embeddings and similarity search',
      'Usage ceilings, key rotation and rate limiting, which the AI provider needs before a public deployment',
      'Notifications and analytics product UI',
      'Self-service signup and assignee picker',
      'Transactional outbox for event publishing',
    ],
  },
];
