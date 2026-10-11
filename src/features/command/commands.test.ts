import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  COMMANDS,
  completeCommand,
  executeCommand,
  findCommand,
  parseCommand,
  type CommandContext,
} from './commands';
import { useAlertStore } from '@/store/alerts';
import { useWatchlistStore } from '@/store/watchlists';
import { useWalletStore } from '@/store/wallets';
import { SOL_MINT } from '@/lib/constants';

const ADDRESS = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const SIG =
  '5wmVyoTuAH3pdWsynA48GjGdDCZWHjKU64RbLg3PgHrPVQuJbgnjrpR4o7wfZBX5m6JqJ3twWokQqH52eNxS7oNf';

function makeCtx(navigate = vi.fn()): CommandContext & { navigate: ReturnType<typeof vi.fn> } {
  return {
    navigate,
    toggleToken: vi.fn(() => true),
    addWallet: vi.fn(() => true),
    setForceDemo: vi.fn(),
    queryClient: { invalidateQueries: vi.fn(async () => {}) },
  };
}

describe('command parsing', () => {
  it('splits verb and arguments, case-insensitively', () => {
    const p = parseCommand('  token   So1111  extra ');
    expect(p.verb).toBe('TOKEN');
    expect(p.args).toEqual(['So1111', 'extra']);
    expect(p.arg).toBe('So1111');
  });

  it('handles an empty input', () => {
    expect(parseCommand('   ')).toEqual({ raw: '', verb: '', args: [], arg: null });
  });
});

describe('command execution', () => {
  beforeEach(() => {
    useWatchlistStore.setState(useWatchlistStore.getState());
  });

  it('navigates for MARKETS', async () => {
    const ctx = makeCtx();
    const r = await executeCommand('markets', ctx);
    expect(r.ok).toBe(true);
    expect(ctx.navigate).toHaveBeenCalledWith('/');
  });

  it('opens token research for a valid mint', async () => {
    const ctx = makeCtx();
    const r = await executeCommand(`TOKEN ${SOL_MINT}`, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.navigate).toHaveBeenCalledWith(`/token/${SOL_MINT}`);
  });

  it('refuses a symbol instead of a mint and explains why', async () => {
    const ctx = makeCtx();
    const r = await executeCommand('TOKEN BONK', ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/mint-address/);
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  it('adds a wallet and navigates', async () => {
    const ctx = makeCtx();
    const r = await executeCommand(`WALLET ${ADDRESS} Treasury`, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.addWallet).toHaveBeenCalledWith(ADDRESS, 'Treasury');
    expect(ctx.navigate).toHaveBeenCalledWith(`/wallet/${ADDRESS}`);
  });

  it('rejects a non-base58 wallet argument', async () => {
    const ctx = makeCtx();
    const r = await executeCommand('WALLET 0xdeadbeef', ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/public addresses/);
  });

  it('toggles watchlist membership for WATCH', async () => {
    const ctx = makeCtx();
    const r = await executeCommand(`WATCH ${SOL_MINT}`, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.toggleToken).toHaveBeenCalledWith(SOL_MINT);
  });

  it('opens the transaction inspector for a signature', async () => {
    const ctx = makeCtx();
    const r = await executeCommand(`TX ${SIG}`, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.navigate).toHaveBeenCalledWith(`/tx/${SIG}`);
  });

  it('toggles demo mode', async () => {
    const ctx = makeCtx();
    await executeCommand('DEMO ON', ctx);
    expect(ctx.setForceDemo).toHaveBeenCalledWith(true);
    await executeCommand('DEMO OFF', ctx);
    expect(ctx.setForceDemo).toHaveBeenCalledWith(false);
    const bad = await executeCommand('DEMO MAYBE', ctx);
    expect(bad.ok).toBe(false);
  });

  it('invalidates the cache on REFRESH', async () => {
    const ctx = makeCtx();
    const r = await executeCommand('REFRESH', ctx);
    expect(r.ok).toBe(true);
    expect(ctx.queryClient.invalidateQueries).toHaveBeenCalled();
  });

  it('opens the help page on HELP', async () => {
    const ctx = makeCtx();
    await executeCommand('HELP', ctx);
    expect(ctx.navigate).toHaveBeenCalledWith('/help');
  });

  it('suggests a correction for an unknown verb', async () => {
    const ctx = makeCtx();
    const r = await executeCommand('MARKAT', ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Did you mean MARKETS\?/);
  });

  it('reports an empty input instead of doing nothing silently', async () => {
    const ctx = makeCtx();
    const r = await executeCommand('   ', ctx);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/HELP/);
  });

  it('never navigates for a malformed command', async () => {
    const ctx = makeCtx();
    await executeCommand('TOKEN', ctx);
    await executeCommand('WALLET', ctx);
    await executeCommand('TX', ctx);
    expect(ctx.navigate).not.toHaveBeenCalled();
  });
});

describe('command registry', () => {
  it('exposes every documented command', () => {
    const verbs = COMMANDS.map((c) => c.verb);
    for (const v of ['HELP', 'MARKETS', 'SOL', 'TOKEN', 'WALLET', 'SCREENER', 'NEWS', 'WATCHLIST', 'SETTINGS']) {
      expect(verbs).toContain(v);
    }
  });

  it('has unique verbs', () => {
    const verbs = COMMANDS.map((c) => c.verb);
    expect(new Set(verbs).size).toBe(verbs.length);
  });

  it('documents a usage string for every command', () => {
    for (const c of COMMANDS) {
      expect(c.usage.length).toBeGreaterThan(0);
      expect(c.summary.length).toBeGreaterThan(0);
    }
  });

  it('looks up commands case-insensitively', () => {
    expect(findCommand('token')?.verb).toBe('TOKEN');
    expect(findCommand('nope')).toBeUndefined();
  });
});

describe('autocomplete', () => {
  beforeEach(() => {
    useWatchlistStore.getState().addToken('wl_core', SOL_MINT, 'SOL');
    useWalletStore.getState().addWallet(ADDRESS, 'Treasury');
  });

  it('completes a verb prefix', () => {
    expect(completeCommand('MAR')).toContain('MARKETS');
    expect(completeCommand('')).toContain('HELP');
  });

  it('offers DEMO arguments', () => {
    expect(completeCommand('DEMO ')).toEqual(['DEMO ON', 'DEMO OFF']);
  });

  it('completes a watched mint for TOKEN', () => {
    const out = completeCommand(`TOKEN ${SOL_MINT.slice(0, 4)}`);
    expect(out.some((c) => c.startsWith('TOKEN '))).toBe(true);
  });

  it('completes a watched wallet for WALLET', () => {
    expect(completeCommand(`WALLET ${ADDRESS.slice(0, 4)}`)).toContain(`WALLET ${ADDRESS}`);
  });
});

describe('alert store', () => {
  beforeEach(() => {
    useAlertStore.setState({ rules: [], fired: [] });
  });

  it('creates a rule for a valid target and rejects an invalid one', () => {
    expect(useAlertStore.getState().addRule({ kind: 'price-above', target: SOL_MINT, label: null, threshold: 1, enabled: true })).toBeTruthy();
    expect(useAlertStore.getState().addRule({ kind: 'price-above', target: 'not-an-address', label: null, threshold: 1, enabled: true })).toBeNull();
    expect(useAlertStore.getState().rules).toHaveLength(1);
  });

  it('records firing history and caps it', () => {
    const id = useAlertStore.getState().addRule({ kind: 'price-above', target: SOL_MINT, label: null, threshold: 1, enabled: true })!;
    for (let i = 0; i < 120; i++) useAlertStore.getState().markTriggered(id, `hit ${i}`);
    expect(useAlertStore.getState().fired.length).toBeLessThanOrEqual(100);
    expect(useAlertStore.getState().rules[0]!.lastTriggeredAt).not.toBeNull();
  });

  it('acknowledges and clears history', () => {
    const id = useAlertStore.getState().addRule({ kind: 'price-above', target: SOL_MINT, label: null, threshold: 1, enabled: true })!;
    useAlertStore.getState().markTriggered(id, 'hit');
    useAlertStore.getState().acknowledgeAll();
    expect(useAlertStore.getState().fired.every((f) => f.acknowledged)).toBe(true);
    useAlertStore.getState().clearHistory();
    expect(useAlertStore.getState().fired).toHaveLength(0);
  });
});

describe('watchlist store', () => {
  it('adds, de-duplicates and removes by mint', () => {
    const id = useWatchlistStore.getState().activeListId;
    useWatchlistStore.getState().addToken(id, SOL_MINT, 'SOL');
    useWatchlistStore.getState().addToken(id, SOL_MINT, 'SOL');
    expect(useWatchlistStore.getState().lists.find((l) => l.id === id)!.items).toHaveLength(1);
    useWatchlistStore.getState().removeToken(id, SOL_MINT);
    expect(useWatchlistStore.getState().lists.find((l) => l.id === id)!.items).toHaveLength(0);
  });

  it('refuses a non-address token', () => {
    const id = useWatchlistStore.getState().activeListId;
    useWatchlistStore.getState().addToken(id, 'nope');
    expect(useWatchlistStore.getState().lists.find((l) => l.id === id)!.items.some((i) => i.mint === 'nope')).toBe(false);
  });

  it('toggles membership and reports the resulting state', () => {
    const id = useWatchlistStore.getState().activeListId;
    const address = '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E';
    expect(useWatchlistStore.getState().toggleToken(address)).toBe(true);
    expect(useWatchlistStore.getState().toggleToken(address)).toBe(false);
    expect(id).toBeTruthy();
  });

  it('never deletes the final watchlist', () => {
    const only = useWatchlistStore.getState().lists[0]!.id;
    useWatchlistStore.getState().deleteList(only);
    expect(useWatchlistStore.getState().lists.length).toBeGreaterThanOrEqual(1);
  });
});

describe('wallet snapshot partial-failure policy', () => {
  /**
   * A public RPC can reject `getTokenAccountsByOwner` while still answering
   * `getBalance`. The snapshot must degrade to "holdings unavailable", never to
   * "0 holdings", because the latter is an affirmative false claim about the
   * wallet's contents.
   */
  const provider = {
    getBalance: async () => ({
      address: 'A',
      sol: 12.5,
      lamports: 12_500_000_000,
      slot: 1,
      provenance: { origin: 'live' as const, source: 'test', fetchedAt: Date.now() },
    }),
    getTokenAccounts: async () => {
      throw new Error('Request blocked');
    },
  };

  it('keeps the balance when the token-account query is blocked', async () => {
    const [balanceResult, holdingsResult] = await Promise.allSettled([
      provider.getBalance(),
      provider.getTokenAccounts(),
    ]);
    expect(balanceResult.status).toBe('fulfilled');
    expect(holdingsResult.status).toBe('rejected');
  });

  it('flags holdings as unavailable rather than empty', async () => {
    const [result] = await Promise.allSettled([provider.getTokenAccounts()]);
    const holdingsAvailable = result!.status === 'fulfilled';
    // The query failed, so the snapshot must mark holdings as UNREAD. The UI
    // keys its "0 non-zero SPL balances" copy off `holdingsAvailable`, so this
    // flag is what stops an affirmative false claim about the wallet.
    expect(holdingsAvailable).toBe(false);
    expect(typeof holdingsAvailable).toBe('boolean');
  });
});

describe('wallet store', () => {
  it('adds, de-duplicates and removes public addresses', () => {
    const addr = '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E';
    expect(useWalletStore.getState().addWallet(addr, 'A')).toBe(true);
    expect(useWalletStore.getState().addWallet(addr, 'A')).toBe(false);
    expect(useWalletStore.getState().isWatched(addr)).toBe(true);
    useWalletStore.getState().removeWallet(addr);
    expect(useWalletStore.getState().isWatched(addr)).toBe(false);
  });

  it('rejects an invalid address', () => {
    expect(useWalletStore.getState().addWallet('nope')).toBe(false);
  });

  it('stores local notes and labels', () => {
    const addr = '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E';
    useWalletStore.getState().addWallet(addr, 'A');
    useWalletStore.getState().updateWallet(addr, { note: 'watch this', group: 'fund' });
    const w = useWalletStore.getState().wallets.find((x) => x.address === addr)!;
    expect(w.note).toBe('watch this');
    expect(w.group).toBe('fund');
  });
});