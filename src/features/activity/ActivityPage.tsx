import * as React from 'react';
import { Link } from 'react-router-dom';
import { Activity, Info, Radio } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/input';
import { EmptyState, UpdatedAt } from '@/components/ui/states';
import { ActivityTable } from './ActivityTable';
import { useWalletActivity } from '@/data/queries';
import { useWalletStore } from '@/store/wallets';
import { useProviderStore } from '@/store/providers';
import { truncateAddress } from '@/lib/format';
import type { ActivityKind } from '@/types/models';

const KIND_FILTERS: { value: ActivityKind | 'all'; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'swap', label: 'Swaps' },
  { value: 'close-account', label: 'Closed accounts' },
  { value: 'unknown', label: 'Unclassified' },
];

export function ActivityPage() {
  const wallets = useWalletStore((s) => s.wallets);
  const tracked = wallets.filter((w) => w.trackActivity);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);
  const [limit, setLimit] = React.useState(20);
  const [kindFilter, setKindFilter] = React.useState<ActivityKind | 'all'>('all');
  const [addressFilter, setAddressFilter] = React.useState<string>('all');

  const addresses = tracked.map((w) => w.address);
  const activity = useWalletActivity(addresses, limit);

  const records = React.useMemo(() => {
    let list = activity.data?.records ?? [];
    if (kindFilter !== 'all') list = list.filter((r) => r.kind === kindFilter);
    if (addressFilter !== 'all') list = list.filter((r) => r.account === addressFilter);
    return list;
  }, [activity.data, kindFilter, addressFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface-1 px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-300">
          <Radio size={12} className="text-cyan" />
          <span className="font-semibold uppercase tracking-wider text-dim">Live feed</span>
        </div>
        <Select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as ActivityKind | 'all')}
          className="w-36"
          aria-label="Filter by transaction type"
        >
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select
          value={addressFilter}
          onChange={(e) => setAddressFilter(e.target.value)}
          className="w-44"
          aria-label="Filter by watched address"
        >
          <option value="all">All watched addresses</option>
          {tracked.map((w) => (
            <option key={w.address} value={w.address}>
              {w.label ?? truncateAddress(w.address, 5)}
            </option>
          ))}
        </Select>
        <Select
          value={String(limit)}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="w-24"
          aria-label="Signatures per address"
        >
          {[10, 20, 40, 60].map((n) => (
            <option key={n} value={n}>
              {n} / addr
            </option>
          ))}
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="neutral">polling every {Math.max(pollSec, 20)}s while this tab is open</Badge>
          <Button size="sm" variant="outline" onClick={() => void activity.refetch()} disabled={activity.isFetching}>
            Refresh
          </Button>
          <UpdatedAt timestamp={activity.dataUpdatedAt} isFetching={activity.isFetching} />
        </div>
      </div>

      <Panel className="min-h-0 flex-1 rounded-none border-0">
        <PanelHeader
          title="On-chain activity"
          icon={<Activity size={12} />}
          subtitle={`· ${records.length} records from ${tracked.length} address(es)`}
        />
        <PanelBody>
          {tracked.length === 0 ? (
            <EmptyState
              title="No addresses to follow"
              description={
                <>
                  Add a public wallet in{' '}
                  <Link to="/watchlist" className="link">
                    Watchlist
                  </Link>{' '}
                  or run <span className="font-mono text-cyan">WALLET &lt;address&gt;</span>. Only public addresses are
                  supported — Iceberg never asks for a seed phrase.
                </>
              }
              icon={<Activity size={16} />}
            />
          ) : (
            <ActivityTable
              records={records}
              isLoading={activity.isLoading}
              isError={activity.isError}
              onRetry={() => void activity.refetch()}
            />
          )}
        </PanelBody>
      </Panel>

      <div className="flex items-start gap-2 border-t border-edge bg-surface-1 px-3 py-2 text-[10px] leading-relaxed text-dim">
        <Info size={11} className="mt-px shrink-0" />
        <p>
          <strong className="text-slate-400">Classification policy.</strong> Rows are typed only when the parsed
          transaction contains the matching instruction. Iceberg deliberately does <em>not</em> label transactions as
          buys, sells, accumulation, or liquidity additions — those claims need pre/post balances across both legs of a
          route, which aggregators routinely make ambiguous. “Unclassified” means the signature-level response carried no
          parsed instructions; open a signature for full detail.
        </p>
      </div>
    </div>
  );
}