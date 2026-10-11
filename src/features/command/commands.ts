import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { classifyIdentifier, isSolanaAddress } from '@/lib/solana';
import { useWatchlistStore } from '@/store/watchlists';
import { useWalletStore } from '@/store/wallets';
import { useProviderStore } from '@/store/providers';
import { useToast } from './toast';

/**
 * Command interface.
 *
 * Every command performs real navigation or a real state mutation — none of
 * them just print a canned response. Parsing lives here so it is unit
 * testable without a DOM.
 */

export interface CommandContext {
  navigate: (path: string) => void;
  toggleToken: (mint: string, symbol?: string | null) => boolean;
  addWallet: (address: string, label?: string | null) => boolean;
  setForceDemo: (v: boolean) => void;
  queryClient: { invalidateQueries: (opts: { queryKey: unknown[] }) => Promise<void> };
}

export interface CommandResult {
  ok: boolean;
  message: string;
  tone?: 'info' | 'success' | 'warn' | 'error';
}

export interface ParsedCommand {
  raw: string;
  verb: string;
  args: string[];
  /** The full token or address argument, when present. */
  arg: string | null;
}

export function parseCommand(raw: string): ParsedCommand {
  const trimmed = raw.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const verb = (parts[0] ?? '').toUpperCase();
  const args = parts.slice(1);
  return { raw: trimmed, verb, args, arg: args[0] ?? null };
}

export interface CommandDefinition {
  verb: string;
  usage: string;
  summary: string;
  category: 'navigation' | 'research' | 'workspace' | 'help';
  run: (ctx: CommandContext, parsed: ParsedCommand) => CommandResult | Promise<CommandResult>;
}

const needAddress = (v: string | null): string | null => (v && isSolanaAddress(v) ? v : null);

export const COMMANDS: CommandDefinition[] = [
  {
    verb: 'HELP',
    usage: 'HELP',
    summary: 'List every available command',
    category: 'help',
    run: () => ({ ok: true, message: 'Opened command reference.' }),
  },
  {
    verb: 'MARKETS',
    usage: 'MARKETS',
    summary: 'Open the market overview workstation',
    category: 'navigation',
    run: (ctx) => {
      ctx.navigate('/');
      return { ok: true, message: 'Navigated to Markets.', tone: 'success' };
    },
  },
  {
    verb: 'SOL',
    usage: 'SOL',
    summary: 'Solana network overview (SOL/USDC)',
    category: 'research',
    run: (ctx) => {
      ctx.navigate('/markets/solana');
      return { ok: true, message: 'Opened Solana overview.', tone: 'success' };
    },
  },
  {
    verb: 'SCREENER',
    usage: 'SCREENER',
    summary: 'Token discovery and screening',
    category: 'navigation',
    run: (ctx) => {
      ctx.navigate('/screener');
      return { ok: true, message: 'Navigated to Screener.', tone: 'success' };
    },
  },
  {
    verb: 'ACTIVITY',
    usage: 'ACTIVITY',
    summary: 'On-chain activity feed for watched wallets',
    category: 'navigation',
    run: (ctx) => {
      ctx.navigate('/activity');
      return { ok: true, message: 'Navigated to Activity feed.', tone: 'success' };
    },
  },
  {
    verb: 'FLOWS',
    usage: 'FLOWS',
    summary: 'Liquidity and market-flow analytics',
    category: 'navigation',
    run: (ctx) => {
      ctx.navigate('/flows');
      return { ok: true, message: 'Navigated to Flows.', tone: 'success' };
    },
  },
  {
    verb: 'NEWS',
    usage: 'NEWS',
    summary: 'News and research feed',
    category: 'navigation',
    run: (ctx) => {
      ctx.navigate('/news');
      return { ok: true, message: 'Navigated to News.', tone: 'success' };
    },
  },
  {
    verb: 'WATCHLIST',
    usage: 'WATCHLIST',
    summary: 'Saved tokens, wallets and alert rules',
    category: 'navigation',
    run: (ctx) => {
      ctx.navigate('/watchlist');
      return { ok: true, message: 'Navigated to Watchlist.', tone: 'success' };
    },
  },
  {
    verb: 'SETTINGS',
    usage: 'SETTINGS',
    summary: 'Providers, BYOK credentials and preferences',
    category: 'navigation',
    run: (ctx) => {
      ctx.navigate('/settings');
      return { ok: true, message: 'Navigated to Settings.', tone: 'success' };
    },
  },
  {
    verb: 'TOKEN',
    usage: 'TOKEN <mint-address>',
    summary: 'Open the research view for a token mint',
    category: 'research',
    run: (ctx, parsed) => {
      const mint = needAddress(parsed.arg);
      if (!mint) {
        return {
          ok: false,
          tone: 'error',
          message: 'Usage: TOKEN <mint-address>. The canonical identifier is the mint, not the symbol.',
        };
      }
      ctx.navigate(`/token/${mint}`);
      return { ok: true, message: 'Opened token research view.', tone: 'success' };
    },
  },
  {
    verb: 'WALLET',
    usage: 'WALLET <address> [label]',
    summary: 'Analyse a public wallet (read-only, no keys)',
    category: 'research',
    run: (ctx, parsed) => {
      const addr = needAddress(parsed.arg);
      if (!addr) {
        return { ok: false, tone: 'error', message: 'Usage: WALLET <base58-address>. Only public addresses are supported.' };
      }
      const label = parsed.args[1] ?? null;
      const added = ctx.addWallet(addr, label);
      ctx.navigate(`/wallet/${addr}`);
      return {
        ok: true,
        tone: 'success',
        message: added ? `Added ${label ? `"${label}" ` : ''}to your wallet watchlist.` : 'Opened wallet view.',
      };
    },
  },
  {
    verb: 'WATCH',
    usage: 'WATCH <mint-address>',
    summary: 'Toggle a token on the active watchlist',
    category: 'workspace',
    run: (ctx, parsed) => {
      const mint = needAddress(parsed.arg);
      if (!mint) return { ok: false, tone: 'error', message: 'Usage: WATCH <mint-address>.' };
      const nowWatched = ctx.toggleToken(mint);
      return {
        ok: true,
        tone: 'success',
        message: nowWatched ? 'Added to the active watchlist.' : 'Removed from the active watchlist.',
      };
    },
  },
  {
    verb: 'REFRESH',
    usage: 'REFRESH',
    summary: 'Invalidate cached provider data',
    category: 'workspace',
    run: async (ctx) => {
      await ctx.queryClient.invalidateQueries({ queryKey: [] });
      return { ok: true, tone: 'success', message: 'Cache invalidated — refetching from providers.' };
    },
  },
  {
    verb: 'DEMO',
    usage: 'DEMO ON|OFF',
    summary: 'Toggle deterministic demo data',
    category: 'workspace',
    run: (ctx, parsed) => {
      const arg = (parsed.arg ?? '').toUpperCase();
      if (arg === 'ON') {
        ctx.setForceDemo(true);
        return { ok: true, tone: 'warn', message: 'Demo mode ON — all values are synthetic samples.' };
      }
      if (arg === 'OFF') {
        ctx.setForceDemo(false);
        return { ok: true, tone: 'success', message: 'Demo mode OFF — live provider data will be used.' };
      }
      return { ok: false, tone: 'error', message: 'Usage: DEMO ON | DEMO OFF.' };
    },
  },
  {
    verb: 'TX',
    usage: 'TX <signature>',
    summary: 'Inspect a transaction signature',
    category: 'research',
    run: (ctx, parsed) => {
      const arg = parsed.arg;
      if (!arg || classifyIdentifier(arg) !== 'signature') {
        return { ok: false, tone: 'error', message: 'Usage: TX <transaction-signature>.' };
      }
      ctx.navigate(`/tx/${arg}`);
      return { ok: true, tone: 'success', message: 'Opened transaction inspector.' };
    },
  },
];

export function findCommand(verb: string): CommandDefinition | undefined {
  return COMMANDS.find((c) => c.verb === verb.toUpperCase());
}

/** Tab-completion candidates for the verb position and the argument position. */
export function completeCommand(input: string): string[] {
  const parsed = parseCommand(input);
  if (!parsed.verb) return COMMANDS.map((c) => c.verb);

  // A trailing space means the user has moved on to the argument position.
  const inArgumentPosition = /\s$/.test(input) || parsed.args.length > 0;

  if (!inArgumentPosition) {
    const prefix = input.trim().toUpperCase();
    return COMMANDS.filter((c) => c.verb.startsWith(prefix)).map((c) => c.verb);
  }

  const upperVerb = parsed.verb;
  if (upperVerb === 'DEMO') return ['DEMO ON', 'DEMO OFF'];
  if (upperVerb === 'TOKEN' || upperVerb === 'WATCH') {
    return useWatchlistStore
      .getState()
      .watchedMints()
      .slice(0, 8)
      .map((m) => `${upperVerb} ${m}`);
  }
  if (upperVerb === 'WALLET' || upperVerb === 'TX') {
    return useWalletStore
      .getState()
      .wallets.map((w) => `${upperVerb} ${w.address}`)
      .slice(0, 8);
  }
  return [];
}

/** Wire the stores/navigation into a CommandContext. */
export function useCommandContext(navigate: (to: string) => void): CommandContext {
  const queryClient = useQueryClient();
  const { toggleToken } = useWatchlistStore();
  const { addWallet } = useWalletStore();
  const setForceDemo = useProviderStore((s) => s.setForceDemo);
  const toast = useToast();

  return React.useMemo<CommandContext>(
    () => ({
      navigate: (path) => {
        navigate(path);
        toast.push({ message: `→ ${path}`, tone: 'muted', ttl: 2200 });
      },
      toggleToken: (mint, symbol) => toggleToken(mint, symbol),
      addWallet,
      setForceDemo,
      queryClient,
    }),
    [navigate, toggleToken, addWallet, setForceDemo, queryClient, toast],
  );
}

/**
 * Execute a command line.
 * Returns the raw result so the UI decides how to surface it.
 */
export async function executeCommand(input: string, ctx: CommandContext): Promise<CommandResult> {
  const parsed = parseCommand(input);
  if (!parsed.verb) return { ok: false, tone: 'error', message: 'Enter a command. Try HELP.' };

  if (parsed.verb === 'HELP') {
    ctx.navigate('/help');
    return { ok: true, message: 'Opened command reference.', tone: 'success' };
  }

  const cmd = findCommand(parsed.verb);
  if (!cmd) {
    const suggestion = COMMANDS.find((c) => c.verb.startsWith(parsed.verb.slice(0, 2)));
    return {
      ok: false,
      tone: 'error',
      message: `Unknown command "${parsed.verb}".${suggestion ? ` Did you mean ${suggestion.verb}?` : ' Try HELP.'}`,
    };
  }

  try {
    return await cmd.run(ctx, parsed);
  } catch (e) {
    return {
      ok: false,
      tone: 'error',
      message: e instanceof Error ? e.message : 'Command failed.',
    };
  }
}

export const COMMAND_HELP = COMMANDS.map((c) => ({
  verb: c.verb,
  usage: c.usage,
  summary: c.summary,
  category: c.category,
}));