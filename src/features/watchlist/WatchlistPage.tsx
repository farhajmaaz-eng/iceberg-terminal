import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, Plus, Star, Trash2, Wallet as WalletIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Switch } from '@/components/ui/primitives';
import { EmptyState, UpdatedAt } from '@/components/ui/states';
import { SparklineCell } from '@/components/charts/sparkline-cell';
import { ChangeCell, PriceCell, TokenCell } from '@/components/tables/cells';
import { cn } from '@/lib/utils';
import { formatDateTime, truncateAddress } from '@/lib/format';
import { isSolanaAddress } from '@/lib/solana';
import { useWatchlistStore } from '@/store/watchlists';
import { useWalletStore } from '@/store/wallets';
import { useAlertStore, type AlertKind } from '@/store/alerts';
import { useProviderStore } from '@/store/providers';
import { useSpotPrices, useWatchlistRows } from '@/data/queries';
import { useToast } from '@/features/command/toast';
import { AlertDialog } from './AlertDialog';
import { openPalette } from '@/features/command/command-palette';

export function WatchlistPage() {
  const lists = useWatchlistStore((s) => s.lists);
  const activeListId = useWatchlistStore((s) => s.activeListId);
  const setActive = useWatchlistStore((s) => s.setActive);
  const [newList, setNewList] = React.useState('');
  const toast = useToast();

  const active = lists.find((l) => l.id === activeListId) ?? lists[0];

  const symbols = React.useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const list of lists) for (const i of list.items) map[i.mint] = i.symbol ?? null;
    return map;
  }, [lists]);

  const mints = active?.items.map((i) => i.mint) ?? [];
  const rows = useWatchlistRows(mints, symbols);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex flex-wrap items-center gap-1 border-b border-edge bg-surface-1 px-2 py-1.5">
        {lists.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setActive(l.id)}
            className={cn(
              'rounded-sm border px-2 py-1 text-xs transition-colors',
              l.id === activeListId
                ? 'border-cyan/40 bg-cyan/10 text-cyan'
                : 'border-edge bg-surface-2 text-slate-400 hover:text-slate-100',
            )}
          >
            {l.name}
            <span className="ml-1.5 font-mono text-[10px] text-dim">{l.items.length}</span>
          </button>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newList.trim()) return;
            const id = useWatchlistStore.getState().createList(newList);
            setActive(id);
            setNewList('');
          }}
        >
          <Input
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
            placeholder="New list…"
            className="w-28"
            aria-label="New watchlist name"
          />
          <Button size="icon" variant="outline" type="submit" aria-label="Create list">
            <Plus size={11} />
          </Button>
        </form>
        {lists.length > 1 && active ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => {
              if (useWatchlistStore.getState().deleteList(active.id)) toast.push({ message: 'List deleted.', tone: 'info' });
            }}
          >
            <Trash2 size={11} /> Delete list
          </Button>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-edge xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Panel className="min-h-0">
          <PanelHeader
            title={`Tokens · ${active?.name ?? ''}`}
            icon={<Star size={12} />}
            actions={
              <>
                <UpdatedAt timestamp={useSpotPrices(mints).dataUpdatedAt} />
                <Button size="sm" variant="ghost" onClick={() => openPalette('search', '')}>
                  <Plus size={11} /> Add token
                </Button>
              </>
            }
          />
          <PanelBody>
            {rows.length === 0 ? (
              <EmptyState
                title="This list is empty"
                description={
                  <>
                    Add a token with <span className="font-mono text-cyan">WATCH &lt;mint-address&gt;</span> in the command
                    palette, or search above.
                  </>
                }
                icon={<Star size={16} />}
              />
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Token</th>
                    <th scope="col" className="text-right">Price</th>
                    <th scope="col" className="text-right">24h</th>
                    <th scope="col" className="text-right">Liquidity</th>
                    <th scope="col" className="text-right">Trend</th>
                    <th scope="col">Note</th>
                    <th scope="col" className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const item = active!.items.find((i) => i.mint === r.mint);
                    return (
                      <tr key={r.mint}>
                        <td>
                          <TokenCell mint={r.mint} symbol={r.symbol} size="sm" />
                        </td>
                        <td className="text-right">
                          <PriceCell value={r.priceUsd} />
                        </td>
                        <td className="text-right">
                          <ChangeCell value={r.change24h} />
                        </td>
                        <td className="text-right">
                          <span className="tnum text-slate-300">
                            {r.liquidityUsd === null ? '—' : `$${Math.round(r.liquidityUsd).toLocaleString('en-US')}`}
                          </span>
                        </td>
                        <td className="text-right">
                          <SparklineCell data={r.sparkline} width={64} height={18} />
                        </td>
                        <td>
                          <NoteEditor mint={r.mint} initial={item?.note ?? null} />
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <RemoveButton mint={r.mint} />
                            <AlertTrigger mint={r.mint} symbol={r.symbol} price={r.priceUsd} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </PanelBody>
        </Panel>

        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <WalletsPanel />
          <AlertsPanel />
        </div>
      </div>
    </div>
  );
}

function RemoveButton({ mint }: { mint: string }) {
  const activeId = useWatchlistStore((s) => s.activeListId);
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label="Remove from list"
      onClick={() => useWatchlistStore.getState().removeToken(activeId, mint)}
    >
      <Trash2 size={11} />
    </Button>
  );
}

function AlertTrigger({ mint, symbol, price }: { mint: string; symbol: string | null; price: number | null }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="icon-sm" variant="ghost" aria-label="Create alert" onClick={() => setOpen(true)}>
        <Bell size={11} />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen} target={mint} symbol={symbol} defaultPrice={price} />
    </>
  );
}

function NoteEditor({ mint, initial }: { mint: string; initial: string | null }) {
  const activeId = useWatchlistStore((s) => s.activeListId);
  const setNote = useWatchlistStore((s) => s.setNote);
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(initial ?? '');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(initial ?? '');
          setOpen(true);
        }}
        className="max-w-[16rem] truncate text-left text-[10px] text-dim hover:text-slate-300"
        title={initial ?? 'Add a note'}
      >
        {initial || '+ note'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setNote(activeId, mint, value);
            setOpen(false);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        className="h-6 w-40"
        placeholder="Local note…"
      />
      <Button
        size="icon-sm"
        variant="bull"
        onClick={() => {
          setNote(activeId, mint, value);
          setOpen(false);
        }}
        aria-label="Save note"
      >
        ✓
      </Button>
    </div>
  );
}

function WalletsPanel() {
  const wallets = useWalletStore((s) => s.wallets);
  const addWallet = useWalletStore((s) => s.addWallet);
  const removeWallet = useWalletStore((s) => s.removeWallet);
  const updateWallet = useWalletStore((s) => s.updateWallet);
  const [addr, setAddr] = React.useState('');
  const [label, setLabel] = React.useState('');
  const toast = useToast();

  return (
    <Panel className="min-h-[14rem]">
      <PanelHeader title="Watched public wallets" icon={<WalletIcon size={12} />} subtitle={`· ${wallets.length}`} />
      <PanelBody>
        <form
          className="flex gap-1 border-b border-edge p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isSolanaAddress(addr)) {
              toast.push({ message: 'That is not a valid Solana address.', tone: 'error' });
              return;
            }
            if (addWallet(addr, label)) {
              setAddr('');
              setLabel('');
              toast.push({ message: 'Wallet added.', tone: 'success' });
            } else {
              toast.push({ message: 'Wallet is already in the list.', tone: 'warn' });
            }
          }}
        >
          <Input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="Base58 address"
            className="flex-1"
            aria-label="Wallet address"
          />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="w-24" aria-label="Wallet label" />
          <Button size="icon" variant="outline" type="submit" aria-label="Add wallet">
            <Plus size={11} />
          </Button>
        </form>

        {wallets.length === 0 ? (
          <EmptyState title="No wallets tracked" description="Paste any public Solana address to follow its activity." icon={<WalletIcon size={14} />} />
        ) : (
          <ul className="divide-y divide-edge/60">
            {wallets.map((w) => (
              <li key={w.address} className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Link to={`/wallet/${w.address}`} className="min-w-0 flex-1 truncate font-mono text-[10px] text-cyan hover:underline">
                    {w.label ? `${w.label} · ` : ''}
                    {truncateAddress(w.address, 6)}
                  </Link>
                  <label className="flex items-center gap-1 text-[9px] text-dim" title="Include in the activity feed">
                    <Switch
                      checked={w.trackActivity}
                      onCheckedChange={(v) => updateWallet(w.address, { trackActivity: v })}
                      aria-label={`Track activity for ${w.label ?? w.address}`}
                    />
                  </label>
                  <Button size="icon-sm" variant="ghost" onClick={() => removeWallet(w.address)} aria-label="Remove wallet">
                    <Trash2 size={11} />
                  </Button>
                </div>
                <NoteEditor2
                  value={w.note}
                  onSave={(v) => updateWallet(w.address, { note: v })}
                  placeholder="Local note about this address…"
                />
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-edge p-2 text-[10px] leading-relaxed text-dim">
          Public addresses only. Iceberg never asks for, stores or transmits a seed phrase or private key — there is no
          field for one anywhere in the application.
        </p>
      </PanelBody>
    </Panel>
  );
}

function NoteEditor2({ value, onSave, placeholder }: { value: string | null; onSave: (v: string | null) => void; placeholder: string }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value ?? '');
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value ?? '');
          setEditing(true);
        }}
        className="mt-0.5 block max-w-full truncate text-left text-[10px] text-dim hover:text-slate-300"
      >
        {value || '+ note'}
      </button>
    );
  }
  return (
    <Textarea
      autoFocus
      rows={2}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onSave(draft.trim() || null);
        setEditing(false);
      }}
      className="mt-1 h-auto text-[10px]"
    />
  );
}

const KIND_LABEL: Record<AlertKind, string> = {
  'price-above': 'Price ≥',
  'price-below': 'Price ≤',
  'change-up': '24h ≥',
  'change-down': '24h ≤',
  'volume-spike': 'Baseline ×',
};

function AlertsPanel() {
  const rules = useAlertStore((s) => s.rules);
  const toggleRule = useAlertStore((s) => s.toggleRule);
  const removeRule = useAlertStore((s) => s.removeRule);
  const fired = useAlertStore((s) => s.fired);
  const clearHistory = useAlertStore((s) => s.clearHistory);
  const pollIntervalSec = useProviderStore((s) => s.alerts.pollIntervalSec);

  return (
    <Panel className="min-h-[12rem] flex-1">
      <PanelHeader title="Alert rules" icon={<Bell size={12} />} subtitle={`· ${rules.length} · polls every ${pollIntervalSec}s`} />
      <PanelBody>
        {rules.length === 0 ? (
          <EmptyState title="No alert rules" description="Use the bell icon next to any watchlisted token to create one." icon={<BellOff size={14} />} />
        ) : (
          <ul className="divide-y divide-edge/60">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-2 py-1.5">
                <Switch checked={r.enabled} onCheckedChange={() => toggleRule(r.id)} aria-label={`Toggle ${r.label ?? r.target}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11px] text-slate-200">
                    {r.label ?? truncateAddress(r.target, 4)}
                  </div>
                  <div className="font-mono text-[10px] text-dim">
                    {KIND_LABEL[r.kind]} {r.threshold}
                    {r.lastTriggeredAt ? ` · fired ${formatDateTime(r.lastTriggeredAt)}` : ''}
                  </div>
                </div>
                <Link to={`/token/${r.target}`} className="text-[10px] text-cyan hover:underline">
                  open
                </Link>
                <Button size="icon-sm" variant="ghost" onClick={() => removeRule(r.id)} aria-label="Delete rule">
                  <Trash2 size={11} />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {fired.length > 0 ? (
          <div className="border-t border-edge p-2">
            <div className="flex items-center justify-between">
              <span className="panel-title">History ({fired.length})</span>
              <Button size="sm" variant="ghost" onClick={clearHistory}>
                Clear
              </Button>
            </div>
            <ul className="mt-1 space-y-0.5">
              {fired.slice(0, 6).map((f) => (
                <li key={f.id} className="truncate text-[10px] text-dim" title={f.message}>
                  {f.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** Used by the shell to keep the header count in sync. */
export function useWatchlistCount(): number {
  return useWatchlistStore((s) => s.lists.reduce((acc, l) => acc + l.items.length, 0));
}