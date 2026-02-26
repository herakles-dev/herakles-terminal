import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FeatureCard } from './FeatureCard';

describe('FeatureCard', () => {
  const defaultProps = {
    icon: <span data-testid="test-icon">icon</span>,
    title: 'Test Feature',
    description: 'This is a test feature description.',
  };

  it('renders title and description', () => {
    render(<FeatureCard {...defaultProps} />);

    expect(screen.getByText('Test Feature')).toBeInTheDocument();
    expect(screen.getByText('This is a test feature description.')).toBeInTheDocument();
  });

  it('renders the icon', () => {
    render(<FeatureCard {...defaultProps} />);

    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
  });

  it('applies hover styles on mouseenter', () => {
    const { container } = render(<FeatureCard {...defaultProps} />);

    const card = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(card);

    // Hovered state changes border color via inline style
    // jsdom normalizes rgba values with spaces after commas
    expect(card.style.borderColor).toContain('0.15');
  });

  it('removes hover styles on mouseleave', () => {
    const { container } = render(<FeatureCard {...defaultProps} />);

    const card = container.firstElementChild as HTMLElement;
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);

    expect(card.style.borderColor).toContain('0.06');
  });
});
