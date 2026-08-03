import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import NotFound from '../src/app/not-found';
import GlobalError from '../src/app/error';

/**
 * The 404 and the crash screen. Until Sprint 10.2 neither existed, so a
 * mistyped URL and a thrown segment both fell back to unbranded Next
 * defaults — the two moments a person is most likely to conclude the product
 * is broken.
 */

describe('the page that is not there', () => {
  it('says what happened and offers the two doors that always exist', () => {
    render(<NotFound />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'That page is not here' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Go to your requests' }),
    ).toBeTruthy();
  });

  it('does not apologise or guess', () => {
    render(<NotFound />);
    const body = document.body.textContent ?? '';
    // "Sorry" invites the reader to think somebody failed them; "did you
    // mean" claims a guess the page has no basis for.
    expect(body).not.toMatch(/sorry|oops|did you mean/i);
  });
});

describe('the screen that failed', () => {
  const reset = jest.fn();
  const consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);

  afterAll(() => consoleError.mockRestore());

  function renderError(error: Error & { digest?: string }) {
    reset.mockClear();
    consoleError.mockClear();
    render(<GlobalError error={error} reset={reset} />);
  }

  it('offers to retry, because that is what reset actually does', () => {
    renderError(new Error('boom'));

    const retry = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('never puts the error message on the screen', () => {
    /**
     * In production Next redacts `message` to a generic string; in
     * development it is the real one. A screen that shows a stack trace in
     * one environment and not the other teaches people to distrust it, so
     * this one shows neither.
     */
    renderError(new Error('Cannot read properties of undefined'));

    expect(document.body.textContent).not.toContain(
      'Cannot read properties of undefined',
    );
  });

  it('shows the digest instead, which is what ties this screen to a log', () => {
    const error = Object.assign(new Error('boom'), { digest: 'a1b2c3d4' });
    renderError(error);

    expect(screen.getByText('a1b2c3d4')).toBeTruthy();
    expect(document.body.textContent).toMatch(/if you report this/i);
  });

  it('omits the digest line entirely when there is no digest', () => {
    // Rather than rendering an empty code element somebody would be asked to
    // quote.
    renderError(new Error('boom'));
    expect(document.body.textContent).not.toMatch(/if you report this/i);
  });

  it('still logs the real error where a developer can find it', () => {
    const error = new Error('boom');
    renderError(error);
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it('promises nothing about the cause', () => {
    renderError(new Error('boom'));
    const body = document.body.textContent ?? '';
    // Every domain refusal renders inside the page that raised it (ADR
    // 0020). Reaching this screen means the product does not know.
    expect(body).not.toMatch(
      /permission|not allowed|session expired|try signing in/i,
    );
  });
});
