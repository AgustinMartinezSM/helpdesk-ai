import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../src/components/ui/button';
import { EmptyState } from '../src/components/ui/empty-state';
import { PriorityDot, StatusBadge } from '../src/components/ui/status';
import type { TicketPriority, TicketStatus } from '../src/lib/tickets';

describe('StatusBadge', () => {
  it.each([
    ['open', 'Open'],
    ['in_progress', 'In progress'],
    ['resolved', 'Resolved'],
    ['closed', 'Closed'],
  ])('renders the %s status as "%s"', (status, label) => {
    render(<StatusBadge status={status as TicketStatus} />);

    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe('PriorityDot', () => {
  it.each([
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
    ['urgent', 'Urgent'],
  ])('renders the %s priority as "%s"', (priority, label) => {
    render(<PriorityDot priority={priority as TicketPriority} />);

    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe('Button', () => {
  it('stays focusable while loading (aria-disabled) and swallows clicks', () => {
    const onClick = jest.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', {
      name: 'Save',
    }) as HTMLButtonElement;
    // aria-disabled, not disabled: keyboard focus must not be dropped
    // to <body> when a focused submit button enters its loading state.
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays enabled and clickable by default', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Save</Button>);

    (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).click();
    expect(onClick).toHaveBeenCalled();
  });
});

describe('EmptyState', () => {
  it('renders title, hint and action', () => {
    render(
      <EmptyState
        title="No tickets yet"
        hint="Create your first ticket to get help."
        action={<a href="/tickets/new">Create ticket</a>}
      />,
    );

    expect(screen.getByText('No tickets yet')).toBeTruthy();
    expect(
      screen.getByText('Create your first ticket to get help.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create ticket' })).toBeTruthy();
  });
});
