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
 *
 * `available` does not require a SCREEN — it requires that somebody can use
 * the capability end to end without building anything first. Projection
 * recovery earns it by running unattended at every start; its on-demand half
 * is an operator procedure, and the note says so rather than implying a
 * button exists (Sprint 10.1, ADR 0009's amendment).
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
        name: 'Where the request came from',
        description:
          'Every ticket carries the branch it came from and the service point inside it, both checked against real records when it is created.',
        status: 'available',
        note: 'A service point is a place, not a login — the till, not the cashier. An unknown branch is refused rather than stored.',
      },
      {
        name: 'Assignments',
        description:
          'Give a ticket to the individual technician who owns it — distinct from routing it to a support team, which is a different, finished capability.',
        status: 'api-ready',
        note: 'The tickets API supports assigning a person; the assignee picker UI is planned.',
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
        name: 'Permission-based access',
        description:
          'Every action is checked against a permission, on the server, in every service — one vocabulary shared by the services and the browser.',
        status: 'available',
        note: 'The browser uses that vocabulary to decide what to render. It never decides what to allow; each service refuses on its own.',
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
        name: 'Creating your organization',
        description:
          'Register, name your organization, and be its owner — no database access and nobody else required.',
        status: 'available',
        note: 'Available to somebody who does not belong to an organization yet. Anyone already in one is refused, because the product cannot yet move a person between organizations.',
      },
      {
        name: 'Renaming your organization',
        description:
          'Change the name people see, from the organization screen, without anybody touching a database.',
        status: 'available',
        note: 'The internal key derived from the original name does not change, so URLs, references and provisioning keep working. Editing that key by hand is not offered.',
      },
      {
        name: 'Transferring ownership',
        description:
          'Hand your organization to another active member. They become the owner and you stay on as an administrator.',
        status: 'available',
        note: 'Only the current owner can start it, and only an active member of the same organization can receive it. An organization always has exactly one owner — the database enforces that, not only the code.',
      },
      {
        name: 'Organization setup',
        description:
          'Register the branches you work from, their departments and their service points, and archive what closed.',
        status: 'available',
        note: 'Archiving a branch keeps everything inside it, so reopening restores the branch exactly as it was. Nothing here archives or deletes the organization itself.',
      },
      {
        name: 'Support teams',
        description:
          'Define the groups that resolve tickets — one central team, a regional one, or a team per branch — and route work to them.',
        status: 'available',
        note: 'A support team is the group that resolves a ticket, which is not the same as the department a requester belongs to. A team with no branches listed serves the whole organization.',
      },
      {
        name: 'Bulk onboarding',
        description:
          'Import a spreadsheet of colleagues, check it before anything is created, then issue one invitation per row.',
        status: 'available',
        note: 'It creates invitations, never accounts, and sends nothing — the codes come back on screen for an administrator to hand out. A branch, department or role that does not match exactly is reported, never invented.',
      },
      {
        name: 'Organization profile fields',
        description:
          'Define the fields your organization keeps about its people — an employee number, an internal phone — with your own labels.',
        status: 'api-ready',
        note: 'The API is complete, including a label per language. No screen reads or edits these yet.',
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
        name: 'Tenant isolation',
        description:
          'One organization can never read another. The database itself refuses a row that does not say which organization it belongs to.',
        status: 'available',
        note: 'Enforced in the schema rather than in application code, and applied before any permission is evaluated — so a mistake in permissions can widen a read inside one organization and never across two.',
      },
      {
        name: 'Authorization',
        description:
          'Permission guards on every protected endpoint of every domain service — the gateway routes, the services decide.',
        status: 'available',
      },
      {
        name: 'Shared-computer sessions',
        description:
          'A shop-floor machine can say so at sign-in: the session gets shorter and ends when the browser closes.',
        status: 'available',
        note: 'The form remembers the place — the branch and service point — and never the person. A service point signs nobody in.',
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
        name: 'Projection recovery',
        description:
          'A service that starts long after the others rebuilds what it missed from the service that owns the data, instead of refusing work.',
        status: 'available',
        note: 'It runs on its own at every start. An operator can also ask for a check that changes nothing, or a repair; both are an operator procedure rather than a screen. Differences are reported and never deleted.',
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
  pick('collaboration', 'Permission-based access'),
  pick('security-governance', 'Tenant isolation'),
  pick('support-operations', 'Where the request came from'),
  pick('collaboration', 'Support teams'),
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

/**
 * Look a capability up by area and name. Exported so a page that needs one
 * capability's status — a workflow step, an illustration label — renders it
 * from here rather than typing the word in. Seven pages did type it in, and
 * four of the seven had gone stale by the time Sprint 10.0 found them.
 *
 * It throws on an unknown name deliberately: a renamed capability should
 * break the build, not silently stop being rendered.
 */
export function capability(areaKey: string, name: string): Capability {
  return pick(areaKey, name);
}

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
      'Authentication with refresh token rotation, and a shorter session for a shared computer',
      'Ticket lifecycle, comments, internal notes and full history',
      'Multi-tenancy enforced in the database: no organization can read another',
      'Permission-based authorization end to end, with one vocabulary shared by the services and the browser',
      'Organizations, branches, departments and service points, with tickets carrying the place they came from',
      'Support teams and manual routing, kept distinct from the department a requester belongs to',
      'Invitations as single-use codes, member administration, and a spreadsheet import that issues them in bulk',
      'People directory, profiles, and organization-defined profile fields behind the API',
      'Event-driven platform: audit, notifications and analytics services, and a projection that rebuilds itself from its owner',
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
      'Assignee picker, so a ticket can be given to a person from the screen',
      'Transactional outbox for event publishing',
    ],
  },
];
