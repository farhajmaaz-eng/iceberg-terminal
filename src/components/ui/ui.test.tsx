import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from './primitives';
import { Badge, ProvenanceBadge } from './badge';
import { EmptyState, ErrorState, LoadingState, DemoBanner } from './states';
import { Sparkline } from '@/components/charts/sparkline';

/**
 * Component tests for the data-integrity UI contract:
 *  • missing values render as "—", never "0"
 *  • demo data is always visibly labelled
 *  • errors surface real messages, never a fake success
 */

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ProvenanceBadge', () => {
  it('labels demo data unmistakably', () => {
    wrap(<ProvenanceBadge origin="demo" source="Synthetic" />);
    expect(screen.getByText(/demo data/i)).toBeInTheDocument();
  });

  it('marks stale live data', () => {
    wrap(<ProvenanceBadge origin="live" source="DexScreener" stale />);
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
  });

  it('names the live source', () => {
    wrap(<ProvenanceBadge origin="live" source="DexScreener" />);
    expect(screen.getByText('DexScreener')).toBeInTheDocument();
  });
});

describe('DemoBanner', () => {
  it('states plainly that the numbers are not live prices', () => {
    wrap(<DemoBanner reason="Provider unavailable." />);
    const banner = screen.getByRole('status');
    expect(within(banner).getByText(/not live market prices/i)).toBeInTheDocument();
    expect(banner.textContent).toContain('Provider unavailable.');
  });
});

describe('state components', () => {
  it('renders a loading state', () => {
    wrap(<LoadingState label="Loading candles" />);
    expect(screen.getByText(/Loading candles/)).toBeInTheDocument();
  });

  it('renders an empty state with an explanation', () => {
    wrap(<EmptyState title="Nothing here" description="Add a wallet to see activity." />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('Add a wallet to see activity.')).toBeInTheDocument();
  });

  it('renders the real error message and a retry action', async () => {
    const onRetry = vi.fn();
    wrap(
      <ErrorState
        error={{ message: 'Provider rate limit exceeded (429).', kind: 'rate_limited', hint: 'Raise the interval.' }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Provider rate limit exceeded (429).');
    expect(screen.getByText('Raise the interval.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('never renders a success message when a provider fails', () => {
    wrap(<ErrorState error={new Error('network down')} />);
    expect(screen.queryByText(/success/i)).not.toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('renders each tone', () => {
    wrap(
      <div>
        <Badge tone="bull">UP</Badge>
        <Badge tone="bear">DOWN</Badge>
        <Badge tone="demo">DEMO</Badge>
      </div>,
    );
    expect(screen.getByText('UP')).toBeInTheDocument();
    expect(screen.getByText('DOWN')).toBeInTheDocument();
    expect(screen.getByText('DEMO')).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('renders a path for a real series', () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 4, 5]} />);
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('renders nothing meaningful for an empty series', () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelectorAll('path')).toHaveLength(0);
  });

  it('renders nothing for a null series instead of a fake trend', () => {
    const { container } = render(<Sparkline data={null} />);
    expect(container.querySelectorAll('path')).toHaveLength(0);
  });

  it('ignores non-finite values inside an otherwise valid series', () => {
    const { container } = render(<Sparkline data={[1, Number.NaN, 3, 4]} />);
    expect(container.querySelectorAll('path').length).toBeGreaterThan(0);
  });
});

describe('TooltipProvider wrapper sanity', () => {
  it('renders children without a tooltip trigger', () => {
    render(
      <TooltipProvider>
        <span>ok</span>
      </TooltipProvider>,
    );
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});