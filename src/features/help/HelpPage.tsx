import { Link } from 'react-router-dom';
import { ExternalLink, Keyboard, Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { COMMAND_HELP } from '@/features/command/commands';
import { ALL_PROVIDERS } from '@/providers';

export function HelpPage() {
  const byCategory = COMMAND_HELP.reduce<Record<string, typeof COMMAND_HELP>>((acc, c) => {
    (acc[c.category] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-px overflow-auto bg-edge">
      <Panel className="rounded-none border-0">
        <PanelHeader title="Command reference" icon={<Terminal size={12} />} subtitle="· press ⌘K / Ctrl+K anywhere" />
        <PanelBody className="p-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Object.entries(byCategory).map(([cat, commands]) => (
              <div key={cat}>
                <h3 className="panel-title mb-1.5 capitalize">{cat}</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Usage</th>
                      <th scope="col">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commands.map((c) => (
                      <tr key={c.verb}>
                        <td className="whitespace-nowrap font-mono text-[11px] text-cyan">{c.usage}</td>
                        <td className="whitespace-normal text-[11px] text-slate-400">{c.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Panel className="rounded-none border-0">
        <PanelHeader title="Keyboard" icon={<Keyboard size={12} />} />
        <PanelBody className="p-3">
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['⌘K / Ctrl+K', 'Open command palette'],
              ['/', 'Focus global search'],
              ['Esc', 'Close overlay'],
              ['↑ / ↓', 'Move through results (and command history)'],
              ['Tab', 'Autocomplete the command or argument'],
              ['Enter', 'Run the selected command or result'],
              ['?', 'Toggle this help page'],
            ].map(([key, desc]) => (
              <div key={key} className="flex items-center gap-2 text-[11px]">
                <kbd className="kbd">{key}</kbd>
                <span className="text-slate-400">{desc}</span>
              </div>
            ))}
          </div>
        </PanelBody>
      </Panel>

      <Panel className="rounded-none border-0">
        <PanelHeader title="Data sources & attribution" />
        <PanelBody className="p-3">
          <ul className="space-y-2">
            {ALL_PROVIDERS.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                <Badge tone="neutral">{p.category}</Badge>
                <span className="font-medium text-slate-200">{p.label}</span>
                <span className="text-dim">{p.attribution}</span>
                <a
                  href={p.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 font-mono text-[10px] text-cyan hover:underline"
                >
                  docs <ExternalLink size={9} />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-edge pt-2 text-[10px] leading-relaxed text-dim">
            Iceberg Terminal is MIT licensed and not affiliated with any of the providers above. Market data belongs to
            its respective owner; check each provider's terms before commercial use. Respect rate limits — the public
            tiers used by default are intentionally conservative.
          </p>
        </PanelBody>
      </Panel>

      <Panel className="rounded-none border-0">
        <PanelHeader title="What Iceberg will not do" />
        <PanelBody className="p-3">
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-slate-400">
            <li>Fabricate market data, headlines, holder counts, insider activity, or safety scores.</li>
            <li>Present a missing value as zero — unknown fields render as “—”.</li>
            <li>Label a transaction a buy, sell, accumulation or liquidity add without the data to prove it.</li>
            <li>Compute PnL or cost basis from data that cannot support it.</li>
            <li>Claim an alert predicts a price, or that notifications work while the app is closed.</li>
            <li>Ask for a seed phrase or private key, or implement wallet connection, signing or swaps.</li>
          </ul>
          <p className="mt-2 text-[11px] text-dim">
            Found something broken or misleading?{' '}
            <a
              href="https://github.com/farhajmaaz-eng/iceberg-terminal/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              Open an issue
            </a>{' '}
            or read{' '}
            <Link to="/settings" className="link">
              the security notes
            </Link>
            .
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}