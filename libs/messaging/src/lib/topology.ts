/**
 * Names of the shared RabbitMQ topology.
 *
 * One durable topic exchange carries every domain event; the routing key of
 * a message is exactly its event type (e.g. "ticket.created.v1"), so
 * consumers can bind precise types or wildcard families ("ticket.*.v1").
 *
 * Rejected messages never requeue: each consumer queue dead-letters into the
 * shared direct DLX using its own queue name as the routing key, and a
 * per-queue `<queue>.dlq` holds them for inspection and manual replay.
 */
export const EVENTS_EXCHANGE = 'helpdesk.events';

export const EVENTS_DEAD_LETTER_EXCHANGE = 'helpdesk.events.dlx';

export function deadLetterQueueOf(queueName: string): string {
  return `${queueName}.dlq`;
}
