import React from 'react';
import { render, screen } from '@testing-library/react';
import Page from '../src/app/page';

describe('Landing page', () => {
  it('renders the product name as the main heading', () => {
    render(<Page />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('HelpDesk AI');
  });
});
