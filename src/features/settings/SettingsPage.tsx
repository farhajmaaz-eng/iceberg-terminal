import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Key,
  Loader2,
  Lock,
  Shield,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Dialog, DialogContent, DialogHeader, Separator, Switch, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { ALL_PROVIDERS } from '@/providers';
import { type RpcFlavour } from '@/providers/chain/solanaRpc';
import type { ConnectionTestResult, ProviderCategory } from '@/types/models';
import { useProviderStore } from '@/store/providers';
import { useVaultStore, vaultIsLocked } from '@/store/vault';
import { useToast } from '@/features/command/toast';
import { buildRpcContext } from '@/data/context';
import type { RequestContext } from '@/providers/types';
import { applyBundle, buildExport, downloadBundle, ImportError, parseBundle } from '@/lib/workspace';
import { resetLocalData } from '@/lib/workspace';
import { StorageError } from '@/lib/idb';

/**
 * Settings — providers, BYOK credentials, preferences and local data.
 *
 * Every provider in the registry is rendered automatically, so adding a new
 * integration requires no UI changes.
 */

const CATEGORY_LABEL: Record<ProviderCategory, string> = {
  market: 'Market data',
  chain: 'Chain / RPC',
  analytics: 'Analytics',
  news: 'News',
};

export function SettingsPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-px overflow-auto bg-edge">
      <ProvidersSection />
      <PreferencesSection />
      <DataSection />
      <SecuritySection />
    </div>
  );
}

function ProvidersSection() {
  const [category, setCategory] = React.useState<ProviderCategory | 'all'>('all');
  const providers = ALL_PROVIDERS.filter((p) => category === 'all' || p.category === category);

  return (
    <Panel className="shrink-0 rounded-none border-0">
      <PanelHeader
        title="Data providers · BYOK"
        icon={<Database size={12} />}
        subtitle="· keyless providers work out of the box"
        actions={
          <Select value={category} onChange={(e) => setCategory(e.target.value as ProviderCategory | 'all')} className="h-6 w-32" aria-label="Provider category">
            <option value="all">All providers</option>
            <option value="market">Market data</option>
            <option value="chain">Chain / RPC</option>
            <option value="analytics">Analytics</option>
            <option value="news">News</option>
          </Select>
        }
      />
      <PanelBody className="p-3">
        <div className="space-y-2">
          {providers.map((p) => (
            <ProviderCard key={p.id} providerId={p.id} />
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}

function ProviderCard({ providerId }: { providerId: string }) {
  const provider = ALL_PROVIDERS.find((p) => p.id === providerId)!;
  const configs = useProviderStore((s) => s.configs);
  const selectedMarket = useProviderStore((s) => s.selectedMarket);
  const selectedChain = useProviderStore((s) => s.selectedChain);
  const selectedAnalytics = useProviderStore((s) => s.selectedAnalytics);
  const selectedNews = useProviderStore((s) => s.selectedNews);
  const setProviderEnabled = useProviderStore((s) => s.setProviderEnabled);
  const setProviderOption = useProviderStore((s) => s.setProviderOption);
  const setSelected = useProviderStore((s) => s.setSelected);
  const toast = useToast();

  const vault = useVaultStore();
  const apiKey = vault.getKey(provider.id) ?? '';
  const [draftKey, setDraftKey] = React.useState('');
  const [passphrase, setPassphrase] = React.useState('');
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<ConnectionTestResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const config = configs[provider.id] ?? { enabled: true, options: {} };
  const vaultLocked = vaultIsLocked(vault) || (vault.encrypted && !vault.unlocked);
  const selected =
    provider.category === 'market'
      ? selectedMarket === provider.id
      : provider.category === 'chain'
        ? selectedChain === provider.id
        : provider.category === 'analytics'
          ? selectedAnalytics === provider.id
          : selectedNews === provider.id;

  const status = provider.status({ enabled: config.enabled, apiKey, options: config.options });
  const hasStoredKey = vault.hasKey(provider.id);

  const saveKey = async () => {
    setError(null);
    try {
      if (draftKey.trim() === '') {
        await vault.removeKey(provider.id);
        setDraftKey('');
        toast.push({ message: `${provider.label} credential removed.`, tone: 'info' });
      } else {
        await vault.setKey(provider.id, draftKey, passphrase || undefined);
        setDraftKey('');
        setPassphrase('');
        toast.push({
          message: passphrase
            ? `${provider.label} key saved and encrypted at rest.`
            : `${provider.label} key saved (stored obfuscated — set a passphrase for real encryption).`,
          tone: passphrase ? 'success' : 'warn',
        });
      }
      setResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not store the credential.');
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const ctx: RequestContext =
        provider.category === 'chain'
          ? buildRpcContext()
          : { apiKey: vault.getKey(provider.id), options: config.options };
      const res = await provider.testConnection(ctx);
      setResult(res);
    } catch (e) {
      setResult({
        ok: false,
        latencyMs: null,
        detail: e instanceof Error ? e.message : 'Connection test failed.',
        warnings: [],
        checkedAt: Date.now(),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="border border-edge bg-surface-1">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-slate-100">{provider.label}</span>
            <Badge tone="neutral">{CATEGORY_LABEL[provider.category]}</Badge>
            {selected ? <Badge tone="info">active</Badge> : null}
          </div>
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-dim hover:text-cyan"
          >
            {provider.docsUrl} <ExternalLink size={8} />
          </a>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {status.state === 'ready' ? (
            <Badge tone="bull">ready</Badge>
          ) : status.state === 'unconfigured' ? (
            <Badge tone="warn">needs key</Badge>
          ) : status.state === 'disabled' ? (
            <Badge tone="neutral">disabled</Badge>
          ) : (
            <Badge tone="bear">error</Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-1 text-[10px] text-dim">
                Enabled
                <Switch
                  checked={config.enabled !== false}
                  onCheckedChange={(v) => setProviderEnabled(provider.id, v)}
                  aria-label={`Enable ${provider.label}`}
                />
              </label>
            </TooltipTrigger>
            <TooltipContent>{status.detail}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="space-y-2.5 p-3">
        <p className="text-[11px] leading-relaxed text-dim">{status.detail}</p>

        <Capabilities provider={provider} />

        {provider.id === 'solana-rpc' ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Label hint="Public endpoint needs no key">
              Flavour
              <Select
                value={config.options.flavour ?? 'public'}
                onChange={(e) => setProviderOption(provider.id, 'flavour', e.target.value as RpcFlavour)}
              >
                <option value="public">PublicNode (browser-friendly)</option>
                <option value="solana-foundation">Solana Foundation (blocks browsers)</option>
                <option value="helius">Helius (BYOK)</option>
                <option value="alchemy">Alchemy (BYOK)</option>
                <option value="custom">Custom endpoint</option>
              </Select>
            </Label>
            {(config.options.flavour ?? 'public') === 'custom' ? (
              <Label hint="HTTPS JSON-RPC endpoint">
                Endpoint URL
                <Input
                  value={config.options.url ?? ''}
                  onChange={(e) => setProviderOption(provider.id, 'url', e.target.value)}
                  placeholder="https://your-node.example/rpc"
                />
              </Label>
            ) : null}
          </div>
        ) : null}

        {provider.requiresKey ? (
          <div className="space-y-2 rounded-sm border border-edge bg-surface-2/60 p-2">
            <Label
              hint={
                hasStoredKey
                  ? vault.encrypted
                    ? 'Stored encrypted in this browser (AES-GCM)'
                    : 'Stored with weak obfuscation — set a passphrase for real encryption'
                  : 'Stored locally only; sent only to this provider'
              }
            >
              API key {hasStoredKey ? <Badge tone={vault.encrypted ? 'bull' : 'warn'}>{vault.encrypted ? 'encrypted' : 'obfuscated'}</Badge> : null}
              <Input
                type="password"
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder={vaultLocked ? 'Unlock the vault to enter a key' : hasStoredKey ? '••••••••  (enter a new key to replace)' : 'paste your API key'}
                autoComplete="off"
                disabled={vaultLocked}
              />
            </Label>
            {vaultLocked ? (
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber">
                <Lock size={11} className="mt-px shrink-0" />
                The credential vault is locked. Unlock it in <strong>Security notes</strong> below before adding or
                changing keys — storing one while locked would leave the vault open behind your back.
              </p>
            ) : vault.webCryptoAvailable ? (
              <Label hint="Optional. Without one, the key is obfuscated but not encrypted.">
                Vault passphrase
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="new-password"
                  placeholder={vault.encrypted ? 'unchanged' : 'at least 6 characters'}
                />
              </Label>
            ) : (
              <p className="flex items-center gap-1 text-[10px] text-amber">
                <AlertTriangle size={11} /> WebCrypto is unavailable in this context, so credentials cannot be
                encrypted at rest.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void saveKey()}
                disabled={draftKey.trim() === '' || vaultLocked}
              >
                <Key size={11} /> Save key
              </Button>
              {hasStoredKey ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void vault.removeKey(provider.id).then(() => toast.push({ message: 'Key removed.', tone: 'info' }))}
                >
                  <Trash2 size={11} /> Remove key
                </Button>
              ) : null}
              {error ? <span className="text-[10px] text-bear">{error}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void test()} disabled={testing}>
            {testing ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />} Test connection
          </Button>
          {selected ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected(provider.category, null)}>
              Deselect
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setSelected(provider.category, provider.id)}>
              Use as active {CATEGORY_LABEL[provider.category].toLowerCase()} source
            </Button>
          )}
          {result ? (
            <span className={result.ok ? 'text-[10px] text-bull' : 'text-[10px] text-bear'}>
              {result.ok ? <CheckCircle2 size={10} className="mr-1 inline" /> : <XCircle size={10} className="mr-1 inline" />}
              {result.detail}
              {result.latencyMs != null ? ` (${result.latencyMs}ms)` : ''}
            </span>
          ) : null}
        </div>

        {result?.warnings.length ? (
          <ul className="list-disc pl-4 text-[10px] text-amber/90">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Capabilities({ provider }: { provider: (typeof ALL_PROVIDERS)[number] }) {
  const caps = provider.capabilities;
  const list: [string, boolean][] = [
    ['Candles', caps.candles],
    ['Volume', caps.volume],
    ['Liquidity', caps.liquidity],
    ['Market cap', caps.marketCap],
    ['Holders', caps.holderCount],
    ['Token security', caps.tokenSecurity],
    ['Search', caps.tokenSearch],
    ['Discovery', caps.newTokenDiscovery],
    ['Balances', caps.walletBalances],
    ['History', caps.transactionHistory],
    ['News', caps.news],
  ];
  const enabled = list.filter(([, v]) => v).map(([k]) => k);

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-2xs uppercase tracking-wider text-dim">Capabilities</span>
        </TooltipTrigger>
        <TooltipContent>Detected from the provider's documented endpoints. Unknown capabilities stay disabled rather than faked.</TooltipContent>
      </Tooltip>
      {enabled.length === 0 ? (
        <span className="text-[10px] text-dim">none</span>
      ) : (
        enabled.map((c) => (
          <Badge key={c} tone="neutral">
            {c}
          </Badge>
        ))
      )}
      {caps.requiresApiKey ? (
        <Badge tone="warn">BYOK required</Badge>
      ) : (
        <Badge tone="bull">no key needed</Badge>
      )}
    </div>
  );
}

function PreferencesSection() {
  const prefs = useProviderStore((s) => s.prefs);
  const alerts = useProviderStore((s) => s.alerts);
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const updatePrefs = useProviderStore((s) => s.updatePrefs);
  const updateAlerts = useProviderStore((s) => s.updateAlerts);
  const setForceDemo = useProviderStore((s) => s.setForceDemo);
  const setNotifyPermission = useProviderStore((s) => s.setNotifyPermission);
  const toast = useToast();

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') {
      toast.push({ message: 'This browser does not support the Notification API.', tone: 'warn' });
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifyPermission(perm as typeof alerts.notifyPermission);
    updateAlerts({ browserNotifications: perm === 'granted' });
    toast.push({
      message:
        perm === 'granted'
          ? 'Browser notifications enabled for this browser.'
          : `Notification permission: ${perm}`,
      tone: perm === 'granted' ? 'success' : 'warn',
    });
  };

  return (
    <Panel className="shrink-0 rounded-none border-0">
      <PanelHeader title="Preferences" />
      <PanelBody className="space-y-3 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Label hint="Seconds between provider refreshes">
            Refresh interval
            <Select value={String(alerts.pollIntervalSec)} onChange={(e) => updateAlerts({ pollIntervalSec: Number(e.target.value) })}>
              {[15, 30, 60, 120, 300, 600].map((s) => (
                <option key={s} value={s}>
                  {s} seconds
                </option>
              ))}
            </Select>
          </Label>

          <Label hint="Applies to data tables and panels">
            Number format
            <Select value={prefs.numberFormat} onChange={(e) => updatePrefs({ numberFormat: e.target.value as 'compact' | 'full' })}>
              <option value="compact">Compact ($1.2M)</option>
              <option value="full">Full ($1,234,567)</option>
            </Select>
          </Label>

          <Label hint="Mobile uses a dedicated layout; this affects tablet panels">
            Layout density
            <Select value={prefs.density} onChange={(e) => updatePrefs({ density: e.target.value as 'compact' | 'comfortable' })}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
            </Select>
          </Label>
        </div>

        <Separator />

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <Switch
              checked={alerts.browserNotifications}
              onCheckedChange={(v) => {
                if (v && alerts.notifyPermission !== 'granted') void requestNotifications();
                else updateAlerts({ browserNotifications: v });
              }}
              aria-label="Browser notifications"
            />
            Browser notifications for alerts
            <Badge tone="neutral">{alerts.notifyPermission}</Badge>
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-300">
            <Switch checked={forceDemo} onCheckedChange={setForceDemo} aria-label="Force demo mode" />
            Force demo mode
            <Badge tone="demo">synthetic data everywhere</Badge>
          </label>

          <p className="rounded-sm border border-amber/30 bg-amber/5 p-2 text-[10px] leading-relaxed text-amber/90">
            <strong className="font-semibold">Notifications only work while the app is open.</strong> There is no
            background service, no push server and no mobile app. When the tab is closed or the browser suspends it, alert
            evaluation stops and you will not be notified.
          </p>
        </div>
      </PanelBody>
    </Panel>
  );
}

function DataSection() {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');

  const doExport = async () => {
    try {
      const bundle = await buildExport();
      const total = Object.values(bundle.stores).reduce((acc, entries) => acc + entries.length, 0);
      downloadBundle(bundle);
      toast.push({
        message:
          total === 0
            ? 'Exported an empty workspace — there is no local data to save yet.'
            : `Workspace exported (${total} records). API keys are never included.`,
        tone: total === 0 ? 'warn' : 'success',
      });
    } catch (e) {
      // A storage failure must not be reported as a successful export: an
      // empty file that "worked" would destroy the user's backup silently.
      toast.push({
        message:
          e instanceof StorageError
            ? `Export failed — ${e.message} Nothing was saved.`
            : 'Export failed. Nothing was saved.',
        tone: 'error',
      });
    }
  };

  const doImport = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = parseBundle(text);
      const report = await applyBundle(bundle);
      const parts = [`Imported ${report.total} record(s) across ${Object.keys(report.written).length} store(s).`];
      if (report.skipped > 0) {
        parts.push(
          `${report.skipped} record(s) were rejected as malformed and NOT written — ` +
            `your existing data is untouched by them.`,
        );
      }
      if (report.unknownStores.length > 0) {
        parts.push(`Ignored unknown store(s): ${report.unknownStores.join(', ')}.`);
      }
      parts.push('Reloading…');
      toast.push({ message: parts.join(' '), tone: report.skipped > 0 ? 'warn' : 'success' });
      setTimeout(() => window.location.reload(), 1100);
    } catch (e) {
      // Import is atomic: a failure here means NOTHING was written.
      toast.push({
        message:
          e instanceof ImportError
            ? `${e.message} Nothing was changed.`
            : e instanceof StorageError
              ? `Import failed — ${e.message} Nothing was written.`
              : 'Import failed: file is not a valid workspace bundle. Nothing was changed.',
        tone: 'error',
      });
    }
  };

  return (
    <Panel className="shrink-0 rounded-none border-0">
      <PanelHeader title="Local data" subtitle="· watchlists, wallets, notes, alerts, layout" />
      <PanelBody className="space-y-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void doExport()}>
            <Download size={12} /> Export workspace
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload size={12} /> Import workspace
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = '';
            }}
          />
          <Button variant="danger" onClick={() => setResetOpen(true)}>
            <Trash2 size={12} /> Reset local data
          </Button>
        </div>

        <p className="text-[10px] leading-relaxed text-dim">
          Exports use a versioned JSON format (<span className="font-mono text-slate-400">iceberg-terminal.workspace</span>{' '}
          v1). API keys are excluded by construction — the exporter skips the secrets store entirely, and the importer
          rejects any bundle containing one. Imports are <strong className="text-slate-400">atomic</strong>: every record
          is written in a single IndexedDB transaction, so a failure part-way through leaves your existing data completely
          untouched rather than half-restored.
        </p>
      </PanelBody>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="w-[min(94vw,28rem)]">
          <DialogHeader title="Reset all local data?" description="This cannot be undone." />
          <div className="space-y-3 p-4">
            <p className="text-xs leading-relaxed text-slate-300">
              This permanently deletes every watchlist, wallet label and note, alert rule, layout preference and stored
              credential from this browser. Nothing is recoverable.
            </p>
            <Label hint={`Type "${confirmText === 'RESET' ? 'RESET' : 'RESET'}" to confirm`}>
              Confirmation
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESET" />
            </Label>
          </div>
          <div className="flex justify-end gap-2 border-t border-edge px-4 py-3">
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmText.trim().toUpperCase() !== 'RESET'}
              onClick={() => {
                void resetLocalData()
                  .then((report) => {
                    // Report exactly what happened — a reset that only cleared
                    // some stores must not claim success.
                    if (report.failed.length > 0) {
                      toast.push({
                        message: `Reset incomplete. Could not clear: ${report.failed
                          .map((f) => f.store)
                          .join(', ')}.`,
                        tone: 'error',
                      });
                      return;
                    }
                    toast.push({
                      message: report.localStorageCleared
                        ? `Local data cleared (${report.cleared.length} stores). Reloading…`
                        : `Local database cleared, but browser storage could not be reset. Reloading…`,
                      tone: report.localStorageCleared ? 'info' : 'warn',
                    });
                    setTimeout(() => window.location.reload(), 600);
                  })
                  .catch((e: unknown) => {
                    toast.push({
                      message: `Reset failed — ${e instanceof Error ? e.message : 'storage error'}. Nothing was changed.`,
                      tone: 'error',
                    });
                  });
              }}
            >
              Delete everything
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function SecuritySection() {
  const vault = useVaultStore();
  const [unlockPass, setUnlockPass] = React.useState('');
  const [unlockError, setUnlockError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const unlock = async (passphrase?: string) => {
    setBusy(true);
    setUnlockError(null);
    // An omitted passphrase means the encrypted path; an explicit empty string
    // means "reopen an obfuscation-only vault", which has no passphrase.
    const ok = await vault.unlock(passphrase ?? unlockPass);
    setBusy(false);
    if (!ok) setUnlockError(vault.error ?? 'Incorrect passphrase.');
    else setUnlockPass('');
  };

  return (
    <Panel className="shrink-0 rounded-none border-0">
      <PanelHeader title="Security notes" icon={<Shield size={12} />} />
      <PanelBody className="space-y-3 p-3">
        <div className="rounded-sm border border-edge bg-surface-2/60 p-2.5 text-[11px] leading-relaxed text-slate-400">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              No secrets in source, no committed <span className="font-mono">.env</span>. Vite{' '}
              <span className="font-mono">VITE_*</span> variables are inlined into the public bundle, so only non-secret
              defaults live there.
            </li>
            <li>Credentials are held in memory for the tab and persisted only as ciphertext in IndexedDB.</li>
            <li>Keys are transmitted only to the provider they belong to, over HTTPS, using CORS.</li>
            <li>
              Browser-side encryption protects data <em>at rest</em>. It does not protect a key while the app is running,
              nor against a compromised device, malicious extension, or script injection.
            </li>
            <li>There is no telemetry. No keys, addresses or watchlists are sent anywhere by Iceberg.</li>
            <li>Iceberg Terminal is read-only: no wallet connection, no signing, no swapping, no transactions.</li>
            <li>Seed phrases and private keys are never requested — there is no field for one anywhere in the app.</li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {vault.encrypted || (vault.lockedByUser && vault.stored.length > 0) ? (
            <>
              <Badge tone={vault.unlocked ? 'bull' : 'warn'}>
                {vault.unlocked ? 'vault unlocked' : 'vault locked'}
              </Badge>
              {vault.unlocked ? (
                <Button size="sm" variant="outline" onClick={vault.lock}>
                  <Lock size={11} /> Lock vault
                </Button>
              ) : vault.encrypted ? (
                <>
                  <Input
                    type="password"
                    value={unlockPass}
                    onChange={(e) => setUnlockPass(e.target.value)}
                    placeholder="Vault passphrase"
                    className="w-48"
                    aria-label="Vault passphrase"
                  />
                  <Button size="sm" variant="primary" onClick={() => void unlock()} disabled={busy || unlockPass.length < 6}>
                    Unlock
                  </Button>
                </>
              ) : (
                // Obfuscation-only vault: no passphrase exists, so unlocking is
                // simply re-reading the stored records.
                <Button size="sm" variant="primary" onClick={() => void unlock('')} disabled={busy}>
                  Unlock vault
                </Button>
              )}
              {vault.encrypted ? (
                <Badge tone="bull">{vault.stored.length} encrypted credential(s)</Badge>
              ) : (
                <Badge tone="warn">{vault.stored.length} obfuscated credential(s)</Badge>
              )}
            </>
          ) : vault.stored.length > 0 ? (
            <>
              <Badge tone="warn">{vault.stored.length} credential(s) stored with weak obfuscation</Badge>
              <span className="text-[10px] text-dim">Re-save each key with a passphrase to enable AES-GCM encryption.</span>
            </>
          ) : (
            <EmptyState
              title="No credentials stored"
              description="This app works keyless. Add a Birdeye or CryptoPanic key above if you want the extra data."
              className="py-4"
            />
          )}
          {unlockError ? <span className="text-[10px] text-bear">{unlockError}</span> : null}
          {vault.error ? <span className="text-[10px] text-bear">{vault.error}</span> : null}
          {vault.warnings.length > 0 ? (
            <ul className="w-full list-disc space-y-0.5 pl-4 text-[10px] text-amber/90">
              {vault.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          {vault.stored.length > 0 ? (
            <Button size="sm" variant="danger" onClick={() => void vault.clearAll()}>
              <Trash2 size={11} /> Clear vault
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] text-dim">
          <ProvenanceBadge origin="live" source="Iceberg Terminal" />
          <span>v{__APP_VERSION__}</span>
          <span>· MIT licensed · open source</span>
        </div>
      </PanelBody>
    </Panel>
  );
}