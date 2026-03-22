import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleSection } from '../../components/CollapsibleSection';

describe('CollapsibleSection', () => {
  it('is collapsed by default and children not rendered', () => {
    render(
      <CollapsibleSection title="Test Section">
        <div data-testid="child-content">Hello</div>
      </CollapsibleSection>,
    );

    expect(screen.getByText('Test Section')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).toBeNull();
  });

  it('opens on click and shows children', () => {
    render(
      <CollapsibleSection title="Test Section">
        <div data-testid="child-content">Hello</div>
      </CollapsibleSection>,
    );

    fireEvent.click(screen.getByText('Test Section'));
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('respects defaultOpen=true', () => {
    render(
      <CollapsibleSection title="Open Section" defaultOpen>
        <div>Visible</div>
      </CollapsibleSection>,
    );

    expect(screen.getByText('Visible')).toBeInTheDocument();
  });

  it('shows badge when provided', () => {
    render(
      <CollapsibleSection title="With Badge" badge={5}>
        <div>Content</div>
      </CollapsibleSection>,
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
