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

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Prepare message' }));
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

    submit();

    expect(screen.getByText('Please tell me your name.')).toBeTruthy();
    expect(screen.getByText('4 fields need your attention.')).toBeTruthy();
    // The invalid field is programmatically linked to its error.
    const name = screen.getByLabelText('Name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById(name.getAttribute('aria-describedby') as string)
        ?.textContent,
    ).toContain('Please tell me your name.');
    // Still on the form.
    expect(
      screen.getByRole('button', { name: 'Prepare message' }),
    ).toBeTruthy();
  });

  it('rejects a malformed email specifically', () => {
    render(<ContactForm />);
    fillValidForm();
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'casey@' },
    });

    submit();
    act(() => {
      jest.runAllTimers();
    });

    expect(
      screen.getByText('That does not look like a valid email address.'),
    ).toBeTruthy();
    expect(
      screen.queryByRole('heading', { name: 'Your message is ready' }),
    ).toBeNull();
  });

  it('reaches an honest success state that admits nothing was sent', () => {
    render(<ContactForm />);
    fillValidForm();

    submit();
    act(() => {
      jest.runAllTimers();
    });

    const body = document.body.textContent ?? '';
    expect(body).toContain('this demo does not send messages to a server');
    // No pretend delivery language anywhere.
    expect(body).not.toMatch(/has been sent|we'll get back|message sent/i);
    // The live region is mounted before the message arrives, so it is
    // actually announced rather than silently inserted with its content.
    expect(screen.getByRole('status').textContent).toContain(
      'does not send it to a server',
    );
  });

  it('moves focus to the success heading instead of dropping it to body', () => {
    render(<ContactForm />);
    fillValidForm();

    submit();
    act(() => {
      jest.runAllTimers();
    });

    const heading = screen.getByRole('heading', {
      name: 'Your message is ready',
    });
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('ignores a second submit while the first is being prepared', () => {
    render(<ContactForm />);
    fillValidForm();

    const button = screen.getByRole('button', { name: 'Prepare message' });
    submit();
    expect(button.getAttribute('aria-busy')).toBe('true');

    // A second activation must not queue another transition: if the guard
    // were removed, this would schedule a duplicate timer.
    fireEvent.click(button);
    fireEvent.submit(button.closest('form') as HTMLFormElement);
    act(() => {
      jest.runAllTimers();
    });

    expect(
      screen.getAllByRole('heading', { name: 'Your message is ready' }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Prepare message' }),
    ).toBeNull();
  });

  it('offers the mailto handoff only when a contact email is configured', () => {
    // Unconfigured in the test environment: no mailto, and the copy says so.
    render(<ContactForm />);
    fillValidForm();
    submit();
    act(() => {
      jest.runAllTimers();
    });

    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(
      screen.getByText(/Direct contact links are not configured/),
    ).toBeTruthy();
  });

  it('returns focus to the first field when writing another message', () => {
    render(<ContactForm />);
    fillValidForm();
    submit();
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Write another message' }),
    );
    act(() => {
      jest.runAllTimers();
    });

    const name = screen.getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(document.activeElement).toBe(name);
  });
});
