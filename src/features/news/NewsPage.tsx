import * as React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Filter, Newspaper, Search } from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingState, UpdatedAt } from '@/components/ui/states';
import { useNews } from '@/data/queries';
import { useVaultStore } from '@/store/vault';
import { useProviderStore } from '@/store/providers';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * News & research.
 *
 * When no news provider is configured the module shows setup instructions and
 * an empty state. Headlines are NEVER fabricated — there is no "sample news"
 * fallback, by design.
 */
export function NewsPage() {
  const [query, setQuery] = React.useState('');
  const [tagFilter, setTagFilter] = React.useState<string | null>(null);
  const news = useNews(query, 40);
  const hasKey = useVaultStore((s) => Boolean(s.session['cryptopanic']));
  const providerEnabled = useProviderStore((s) => s.configs['cryptopanic']?.enabled !== false);
  const [setupOpen, setSetupOpen] = React.useState(false);

  const items = React.useMemo(() => news.data?.items ?? [], [news.data]);
  const tags = React.useMemo(() => {
    const set = new Set<string>();
    for (const i of items) for (const t of i.tags) set.add(t);
    return [...set].slice(0, 14);
  }, [items]);

  const filtered = tagFilter ? items.filter((i) => i.tags.includes(tagFilter)) : items;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface-1 px-3 py-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headlines — e.g. Solana, ETF, token ticker…"
            className="pl-6"
            aria-label="Search news"
          />
        </div>
        <Button variant="outline" size="md" onClick={() => void news.refetch()} disabled={news.isFetching || !hasKey}>
          Refresh
        </Button>
        <UpdatedAt timestamp={news.dataUpdatedAt} isFetching={news.isFetching} />
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-edge bg-surface-1 px-3 py-1.5">
          <Filter size={10} className="text-dim" />
          <button
            type="button"
            onClick={() => setTagFilter(null)}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
              tagFilter === null ? 'border-cyan/40 bg-cyan/10 text-cyan' : 'border-edge text-dim hover:text-slate-200',
            )}
          >
            all
          </button>
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTagFilter(tagFilter === t ? null : t)}
              className={cn(
                'rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
                tagFilter === t ? 'border-cyan/40 bg-cyan/10 text-cyan' : 'border-edge text-dim hover:text-slate-200',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}

      <Panel className="min-h-0 flex-1 rounded-none border-0">
        <PanelHeader
          title="News & research"
          icon={<Newspaper size={12} />}
          subtitle={`· ${filtered.length} items`}
          actions={news.data?.source ? <ProvenanceBadge origin="live" source={news.data.source} /> : null}
        />
        <PanelBody>
          {!hasKey || !providerEnabled ? (
            <EmptyState
              title="No news provider configured"
              description={
                <>
                  Iceberg Terminal does not bundle headlines and will never invent them. Add a free CryptoPanic
                  developer token to load real, timestamped stories with source links.
                  <br />
                  <br />
                  Your token is stored locally in this browser. It is sent only to CryptoPanic.
                </>
              }
              icon={<Newspaper size={18} />}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => setSetupOpen(true)}>
                    Configure news provider
                  </Button>
                  <Link to="/settings">
                    <Button size="sm" variant="outline">
                      Open settings
                    </Button>
                  </Link>
                </div>
              }
            />
          ) : news.isLoading ? (
            <LoadingState label="Loading news" />
          ) : news.isError ? (
            <ErrorState error={news.error} onRetry={() => void news.refetch()} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No stories matched"
              description={query ? `Nothing returned for “${query}”. Try a different keyword.` : 'The provider returned an empty result set.'}
              icon={<Newspaper size={16} />}
            />
          ) : (
            <ul className="divide-y divide-edge/60">
              {filtered.map((item) => (
                <li key={item.id} className="px-3 py-2 transition-colors hover:bg-surface-2/60">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="block text-sm font-medium leading-snug text-slate-100 hover:text-cyan"
                      >
                        {item.title}
                      </a>
                      {item.summary ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-dim">{item.summary}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-dim">
                        <span className="font-mono">{item.source ?? 'unknown source'}</span>
                        <span>·</span>
                        <span className="font-mono">{formatDateTime(item.publishedAt)}</span>
                        {item.author ? (
                          <>
                            <span>·</span>
                            <span>{item.author}</span>
                          </>
                        ) : null}
                        {item.kind ? <Badge tone="neutral">{item.kind}</Badge> : null}
                        {item.tags.map((t) => (
                          <Badge key={t} tone="info">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="shrink-0 text-dim hover:text-cyan"
                      aria-label="Open source article"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelBody>
      </Panel>

      <div className="border-t border-edge bg-surface-1 px-3 py-2 text-[10px] leading-relaxed text-dim">
        Story text is rendered as plain text from the provider's JSON payload and is never inserted as HTML, so a
        malicious headline cannot execute script in this app.
      </div>

      <NewsSetupDialog open={setupOpen} onOpenChange={setSetupOpen} />
    </div>
  );
}

function NewsSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [token, setToken] = React.useState('');
  const [passphrase, setPassphrase] = React.useState('');
  const setKey = useVaultStore((s) => s.setKey);
  const selected = useProviderStore((s) => s.selectedNews);
  const setSelected = useProviderStore((s) => s.setSelected);
  const setEnabled = useProviderStore((s) => s.setProviderEnabled);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!selected) setSelected('news', 'cryptopanic');
      setEnabled('cryptopanic', true);
      await setKey('cryptopanic', token, passphrase || undefined);
      onOpenChange(false);
      setToken('');
      setPassphrase('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not store the token.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,30rem)]">
        <DialogHeader
          title="Configure CryptoPanic"
          description="Free developer token: https://cryptopanic.com/developers/api/"
        />
        <div className="space-y-3 p-4">
          <Label hint="Sent only to cryptopanic.com over HTTPS">
            Auth token
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="paste your CryptoPanic auth token"
              autoComplete="off"
            />
          </Label>
          <Label hint="Optional — encrypts the token at rest with AES-GCM">
            Vault passphrase (min 6 chars)
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
            />
          </Label>
          {error ? <p className="text-[11px] text-bear">{error}</p> : null}
          <p className="rounded-sm border border-edge bg-surface-2 p-2 text-[10px] leading-relaxed text-dim">
            The token is stored locally in IndexedDB. If you set a passphrase it is encrypted with AES-GCM (PBKDF2-SHA256,
            210k iterations). Browser-side encryption does not protect the token while this tab is running, nor against a
            compromised device or extension.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || token.trim().length === 0}>
            {busy ? 'Saving…' : 'Save token'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}