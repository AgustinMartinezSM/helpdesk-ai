import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ContactForm } from '../src/components/public/contact-form';

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Casey Reviewer' },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'casey@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Subject'), {
    target: { value: 'About the event architecture' },
  });
  fireEvent.change(screen.getByLabelText('Message'), {
    target: {
      value: 'I would like to understand the DLQ strategy in more depth.',
    },
  });
}

describe('ContactForm', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('announces validation errors and does not submit an empty form', () => {
    render(<ContactForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Prepare message' }));

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(1);
    expect(screen.getByText('Please tell me your name.')).toBeTruthy();
    // The invalid field is programmatically linked to its error.
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBe(
      'true',
    );
    // Still on the form — no success state.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reaches an honest success state that admits nothing was sent', () => {
    render(<ContactForm />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare message' }));
    act(() => {
      jest.runAllTimers();
    });

    const status = screen.getByRole('status');
    expect(status.textContent).toContain(
      'this demo does not send messages to a server',
    );
    // No pretend "email sent" language anywhere.
    expect(status.textContent).not.toContain('has been sent');
  });

  it('blocks duplicate submissions while preparing and after success', () => {
    render(<ContactForm />);
    fillValidForm();

    const submit = screen.getByRole('button', { name: 'Prepare message' });
    fireEvent.click(submit);
    // While preparing, the button reports busy and swallows further clicks.
    expect(submit.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(submit);

    act(() => {
      jest.runAllTimers();
    });

    // The form was replaced by the success state — nothing left to resubmit.
    expect(
      screen.queryByRole('button', { name: 'Prepare message' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Write another message' }),
    ).toBeTruthy();
  });

  it('lets the visitor start over after a prepared message', () => {
    render(<ContactForm />);
    fillValidForm();

    fireEvent.click(screen.getByRole('button', { name: 'Prepare message' }));
    act(() => {
      jest.runAllTimers();
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Write another message' }),
    );

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(
      screen.getByRole('button', { name: 'Prepare message' }),
    ).toBeTruthy();
  });
});
