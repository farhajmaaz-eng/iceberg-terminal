import { request } from '@/lib/http';
import { AppError, rpcErrorMessage } from '@/lib/errors';
import { asRecord, n, num, str, toEpochMs } from '@/lib/validate';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@/lib/constants';
import type {
  ActivityRecord,
  Provenance,
  ProviderStatus,
  TokenHolding,
  WalletBalance,
} from '@/types/models';
import type {
  ChainDataProvider,
  MintAccountInfo,
  ProviderId,
  ProviderSetting,
  RequestContext,
} from '../types';

/**
 * Solana JSON-RPC provider.
 *
 * One implementation covers the three common configurations:
 *   • public  — https://api.mainnet-beta.solana.com (rate limited, read-only)
 *   • helius  — https://mainnet.helius-rpc.com/?api-key=…
 *   • alchemy — https://solana-mainnet.g.alchemy.com/v2/…
 *   • custom — any user-supplied JSON-RPC endpoint
 *
 * Helius and Alchemy both permit browser use of RPC for read-only calls under
 * their respective plans; Helius additionally offers enhanced transaction
 * parsing which we detect at runtime but do not require.
 *
 * The app NEVER asks for, accepts, stores or uses a seed phrase or private
 * key. Every method here is read-only.
 */

export type RpcFlavour = 'public' | 'solana-foundation' | 'helius' | 'alchemy' | 'custom';

/**
 * Browser-friendly public Solana RPC.
 *
 * `https://api.mainnet-beta.solana.com` rejects requests carrying a browser
 * `Origin` header (it answers 403 with "Access for origin ... is not allowed"),
 * which makes on-chain modules unusable from a static browser deployment.
 * PublicNode mirrors the same mainnet data and sends
 * `Access-Control-Allow-Origin: *`, so it is the default here.
 * The Solana Foundation endpoint is still selectable for server-side use.
 */
export const PUBLIC_RPC_URL = 'https://solana-rpc.publicnode.com';
export const SOLANA_FOUNDATION_RPC_URL = 'https://api.mainnet-beta.solana.com';

const SOURCE = 'Solana JSON-RPC';
const LAMPORTS_PER_SOL = 1e9;

const CAPS = {
  publicAccess: true,
  requiresApiKey: false,
  browserDirect: true,
  spotPrice: false,
  candles: false,
  volume: false,
  liquidity: false,
  marketCap: false,
  holderCount: false,
  tokenSecurity: false,
  tokenSearch: false,
  newTokenDiscovery: false,
  walletBalances: true,
  walletTokenAccounts: true,
  transactionHistory: true,
  transactionStreaming: false,
  news: false,
} as const;

function prov(sourceId: string): Provenance {
  return { origin: 'live', source: SOURCE, sourceId, fetchedAt: Date.now(), stale: false };
}

/** Strip any credential material before a URL is logged or displayed. */
export function safeEndpointLabel(url: string): string {
  try {
    const u = new URL(url);
    const hasKey = u.searchParams.has('api-key') || u.searchParams.has('apiKey');
    u.search = '';
    u.username = '';
    u.password = '';
    return `${u.origin}${u.pathname}${hasKey ? '?api-key=***' : ''}`;
  } catch {
    return '(invalid endpoint)';
  }
}

/**
 * Resolve the endpoint for a given flavour.
 * Helius/Alchemy keys travel in the URL by provider design; the URL is only
 * ever held in memory + the local vault, never in logs or exports.
 */
export function resolveRpcUrl(
  flavour: RpcFlavour,
  apiKey: string | undefined,
  customUrl: string | undefined,
): string {
  const key = (apiKey ?? '').trim();
  switch (flavour) {
    case 'helius':
      if (!key) throw new AppError('unauthorized', 'Helius requires an API key.', { providerId: 'rpc' });
      return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
    case 'alchemy':
      if (!key) throw new AppError('unauthorized', 'Alchemy requires an API key.', { providerId: 'rpc' });
      return `https://solana-mainnet.g.alchemy.com/v2/${encodeURIComponent(key)}`;
    case 'solana-foundation':
      return SOLANA_FOUNDATION_RPC_URL;
    case 'custom': {
      const url = (customUrl ?? '').trim();
      if (!url) throw new AppError('validation', 'A custom RPC endpoint URL is required.');
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new AppError('validation', 'Custom RPC endpoint is not a valid URL.');
      }
      if (parsed.protocol !== 'https:' && !parsed.hostname.includes('localhost') && !parsed.hostname.includes('127.0.0.1')) {
        throw new AppError('validation', 'Custom RPC endpoint must use HTTPS.');
      }
      return url;
    }
    case 'public':
    default:
      return PUBLIC_RPC_URL;
  }
}

interface RpcCall {
  method: string;
  params?: unknown[];
}

async function rpc<T>(ctx: RequestContext, call: RpcCall, bucket = 'solana-rpc@120'): Promise<T> {
  const endpoint = ctx.options?.['rpcUrl'];
  if (!endpoint) {
    throw new AppError('validation', 'No Solana RPC endpoint configured.', { providerId: 'rpc' });
  }
  const payload = await request<unknown>(endpoint, {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: call.method, params: call.params ?? [] },
    providerId: 'rpc',
    signal: ctx.signal,
    bucket,
    timeoutMs: 15_000,
    attempts: 2,
    headers: {},
    accept: 'application/json',
  });

  if (payload && typeof payload === 'object' && 'error' in payload && payload.error) {
    const msg = rpcErrorMessage(payload) ?? 'JSON-RPC error';
    const code = (payload as { error?: { code?: number } }).error?.code;

    // Solana Foundation's public endpoint rejects browser Origins outright.
    // Surface that as an actionable configuration problem rather than a
    // generic server fault.
    if (code === 403 || /access for origin/i.test(msg)) {
      throw new AppError(
        'forbidden',
        'This RPC endpoint refuses browser requests (it blocks the page Origin).',
        {
          providerId: 'rpc',
          status: 403,
          detail:
            'Switch the Solana RPC flavour to "PublicNode (browser-friendly)" in Settings › Providers, or add a Helius/Alchemy key.',
        },
      );
    }

    const kind =
      code === -32601 ? 'unsupported' : code === -32602 ? 'validation' : code === -32005 ? 'rate_limited' : 'server';
    throw new AppError(kind, msg, { providerId: 'rpc' });
  }

  const result = (payload as { result?: T } | null)?.result;
  if (result === undefined) {
    throw new AppError('parse', 'JSON-RPC response contained no result field.', { providerId: 'rpc' });
  }
  return result;
}

/** Convert raw lamports into SOL. null stays null — never coerced to 0. */
export function lamportsToSol(lamports: unknown): number | null {
  const v = num(lamports);
  return v === null ? null : v / LAMPORTS_PER_SOL;
}

export function mapBalance(address: string, result: unknown): WalletBalance {
  const rec = result as { context?: { slot?: number }; value?: number } | null;
  const lamports = n(rec?.value);
  return {
    address,
    sol: lamportsToSol(lamports),
    lamports,
    slot: n(rec?.context?.slot),
    provenance: prov('rpc.getBalance'),
  };
}

interface ParsedAccount {
  account?: {
    data?: { parsed?: { info?: Record<string, unknown> } } | string;
  };
}

export function mapTokenAccount(rec: ParsedAccount, priceHint: Map<string, number>): TokenHolding {
  const data = rec.account?.data;
  const info: Record<string, unknown> =
    data && typeof data === 'object' && 'parsed' in data
      ? ((data.parsed?.info ?? {}) as Record<string, unknown>)
      : {};
  const mint = str(info.mint) ?? '';
  const decimals = n(info.decimals);
  const tokenAmount = asRecord(info.tokenAmount);
  const uiAmount = n(tokenAmount?.uiAmount);
  const rawAmount = n(tokenAmount?.amount);
  const dec = decimals ?? 0;
  const amount = uiAmount ?? (rawAmount === null ? null : rawAmount / 10 ** dec);
  const price = priceHint.get(mint) ?? null;
  return {
    mint,
    symbol: null,
    amount: amount ?? 0,
    decimals: dec,
    uiAmount: amount ?? 0,
    priceUsd: price,
    valueUsd: price !== null && amount !== null ? price * amount : null,
    provenance: prov('rpc.getTokenAccountsByOwner'),
  };
}

interface RawSignature {
  signature?: string;
  blockTime?: number | null;
  slot?: number;
  err?: unknown;
  confirmationStatus?: string;
  meta?: { err?: unknown; fee?: number };
}

export function mapSignature(rec: RawSignature, account: string | null): ActivityRecord | null {
  const signature = str(rec.signature);
  if (!signature) return null;
  const err = rec.err ?? rec.meta?.err ?? null;
  return {
    signature,
    slot: n(rec.slot),
    blockTime: toEpochMs(rec.blockTime),
    status: err ? 'failed' : 'success',
    kind: 'unknown',
    account,
    feeLamports: n(rec.meta?.fee),
    feeSol: lamportsToSol(n(rec.meta?.fee)),
    tokenAmounts: [],
    solDelta: null,
    computeUnits: null,
    err: err ? 'Transaction failed on chain' : null,
    provenance: prov('rpc.getSignaturesForAddress'),
  };
}

interface ParsedInstruction {
  program?: string;
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
  accounts?: unknown[];
}

interface ParsedTxResult {
  blockTime?: number | null;
  slot?: number;
  meta?: {
    err?: unknown;
    fee?: number;
    computeUnitsConsumed?: number;
    preTokenBalances?: unknown[];
    postTokenBalances?: unknown[];
    preBalances?: number[];
    postBalances?: number[];
  };
  transaction?: { message?: { instructions?: ParsedInstruction[] } };
}

const INSTRUCTION_HINTS: { match: string; kind: ActivityRecord['kind'] }[] = [
  { match: 'spl-token', kind: 'transfer' },
  { match: 'initializeMint', kind: 'mint' },
  { match: 'initializeAccount', kind: 'unknown' },
  { match: 'mintTo', kind: 'mint' },
  { match: 'burn', kind: 'burn' },
  { match: 'closeAccount', kind: 'close-account' },
];

/**
 * Classify a transaction using ONLY what the parsed instructions encode.
 *
 * We deliberately never label a transaction "buy", "sell", "accumulation" or
 * "liquidity add/remove" from heuristics: proving the direction of a swap
 * requires pre/post balances across both legs and is frequently ambiguous on
 * aggregators. The UI labels these as `transfer` / `unknown` accordingly.
 */
export function classifyTransaction(instructions: ParsedInstruction[]): ActivityRecord['kind'] {
  for (const ix of instructions) {
    const prog = (ix.program ?? ix.programId ?? '').toLowerCase();
    const type = ix.parsed?.type ?? '';
    for (const hint of INSTRUCTION_HINTS) {
      if (prog.includes(hint.match.toLowerCase()) || type.toLowerCase() === hint.match.toLowerCase()) {
        return hint.kind;
      }
    }
  }
  if (instructions.some((ix) => ix.program?.toLowerCase() === 'system')) return 'transfer';
  return 'unknown';
}

interface TokenBalanceEntry {
  accountIndex?: number;
  mint?: string;
  uiTokenAmount?: { amount?: string; decimals?: number; uiAmount?: number };
}

export function extractTokenAmounts(result: ParsedTxResult): { amounts: ActivityRecord['tokenAmounts']; solDelta: number | null } {
  const pre = (result.meta?.preTokenBalances ?? []) as TokenBalanceEntry[];
  const post = (result.meta?.postTokenBalances ?? []) as TokenBalanceEntry[];
  const deltaByMint = new Map<string, number>();

  const index = (arr: TokenBalanceEntry[]): Map<number, TokenBalanceEntry> => {
    const m = new Map<number, TokenBalanceEntry>();
    for (const e of arr) if (typeof e.accountIndex === 'number') m.set(e.accountIndex, e);
    return m;
  };
  const preIdx = index(pre);
  const postIdx = index(post);
  const allIdx = new Set<number>([...preIdx.keys(), ...postIdx.keys()]);

  for (const i of allIdx) {
    const p = preIdx.get(i);
    const q = postIdx.get(i);
    const mint = str(p?.mint) ?? str(q?.mint);
    if (!mint) continue;
    const pUi = num(p?.uiTokenAmount?.uiAmount);
    const qUi = num(q?.uiTokenAmount?.uiAmount);
    if (pUi === null && qUi === null) continue;
    const delta = (qUi ?? 0) - (pUi ?? 0);
    if (delta === 0) continue;
    deltaByMint.set(mint, (deltaByMint.get(mint) ?? 0) + delta);
  }

  const amounts = [...deltaByMint.entries()].map(([mint, amount]) => {
    // Decimals are not carried on pre/post balance entries for every node.
    // Rather than invent them, we report the raw UI amount with decimals=0
    // and let the UI label the leg as an observed balance delta.
    return {
      mint,
      symbol: null,
      amount,
      decimals: 0,
      uiAmount: amount,
    } satisfies ActivityRecord['tokenAmounts'][number];
  });

  const preBal = result.meta?.preBalances;
  const postBal = result.meta?.postBalances;
  let solDelta: number | null = null;
  if (Array.isArray(preBal) && Array.isArray(postBal) && preBal.length === postBal.length) {
    const first = (preBal[0] ?? 0) - (result.meta?.fee ?? 0);
    const second = postBal[0] ?? 0;
    solDelta = lamportsToSol(second - first);
  }

  return { amounts, solDelta };
}

export function mapTransaction(
  signature: string,
  result: ParsedTxResult | null,
  account: string | null,
): ActivityRecord | null {
  if (!result) return null;
  const err = result.meta?.err ?? null;
  const instructions = result.transaction?.message?.instructions ?? [];
  const { amounts, solDelta } = extractTokenAmounts(result);

  return {
    signature,
    slot: n(result.slot),
    blockTime: toEpochMs(result.blockTime),
    status: err ? 'failed' : 'success',
    kind: err ? 'unknown' : classifyTransaction(instructions),
    account,
    feeLamports: n(result.meta?.fee),
    feeSol: lamportsToSol(n(result.meta?.fee)),
    tokenAmounts: amounts,
    solDelta,
    computeUnits: n(result.meta?.computeUnitsConsumed),
    err: err ? 'Transaction failed on chain' : null,
    provenance: prov('rpc.getTransaction'),
  };
}

export const solanaRpcProvider: ChainDataProvider = {
  id: 'solana-rpc' as ProviderId,
  label: SOURCE,
  category: 'chain',
  docsUrl: 'https://solana.com/docs/rpc',
  attribution: 'On-chain data from your configured Solana RPC node',
  capabilities: CAPS,
  requiresKey: false,

  status(settings?: ProviderSetting): ProviderStatus {
    const flavour = (settings?.options?.['flavour'] as RpcFlavour) ?? 'public';
    if (settings?.enabled === false) {
      return { state: 'disabled', detail: 'Disabled in Settings › Providers.' };
    }
    if (flavour === 'public') {
      return {
        state: 'ready',
        detail:
          'PublicNode public mainnet endpoint with browser CORS support. Rate limited; add a Helius/Alchemy key for heavy use.',
      };
    }
    if (flavour === 'solana-foundation') {
      return {
        state: 'ready',
        detail: 'Solana Foundation mainnet-beta endpoint. Rejects browser Origins — prefer PublicNode or a keyed RPC here.',
      };
    }
    if (flavour === 'custom') {
      return settings?.options?.['url']
        ? { state: 'ready', detail: `Custom endpoint ${safeEndpointLabel(settings.options['url']!)}.` }
        : { state: 'unconfigured', detail: 'Custom RPC selected but no endpoint URL provided.' };
    }
    if (!settings?.apiKey && !settings?.options?.['apiKeyRef']) {
      return {
        state: 'unconfigured',
        detail: `${flavour === 'helius' ? 'Helius' : 'Alchemy'} requires an API key.`,
      };
    }
    return { state: 'ready', detail: `${flavour === 'helius' ? 'Helius' : 'Alchemy'} RPC configured.` };
  },

  async testConnection(ctx) {
    const started = Date.now();
    try {
      const res = await rpc<{ health?: string; apiVersion?: string }>(ctx, { method: 'getHealth' }, 'solana-rpc@60');
      const ok = res?.health === 'ok';
      return {
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? `Node healthy (${res.apiVersion ?? 'unknown API version'}).` : `Node health: ${res?.health}`,
        warnings: [],
        checkedAt: Date.now(),
      };
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('unknown', 'Connection test failed', { cause: e });
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err.message,
        warnings: err.hint ? [err.hint] : [],
        checkedAt: Date.now(),
      };
    }
  },

  async getBalance(ctx, address) {
    const res = await rpc<unknown>(ctx, { method: 'getBalance', params: [address] });
    return mapBalance(address, res);
  },

  async getTokenAccounts(ctx, address) {
    const priceHint = new Map<string, number>();
    const raw = await rpc<{ context?: { slot?: number }; value?: ParsedAccount[] }>(ctx, {
      method: 'getTokenAccountsByOwner',
      params: [
        address,
        { programId: TOKEN_PROGRAM_ID },
        { encoding: 'jsonParsed', commitment: 'confirmed' },
      ],
    });

    const out: TokenHolding[] = [];
    for (const acc of raw?.value ?? []) {
      const holding = mapTokenAccount(acc, priceHint);
      if (!holding.mint) continue;
      if (holding.uiAmount === 0) continue; // zero-balance ATA rows are noise
      out.push(holding);
    }
    return out;
  },

  async getSignatures(ctx, address, opts) {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const filter: Record<string, unknown> = { limit };
    if (opts?.before) filter.before = opts.before;
    if (opts?.until) filter.until = opts.until;

    const res = await rpc<RawSignature[]>(ctx, {
      method: 'getSignaturesForAddress',
      params: [address, filter],
    });
    return (res ?? [])
      .map((r) => mapSignature(r, address))
      .filter((r): r is ActivityRecord => r !== null);
  },

  async getTransaction(ctx, signature) {
    const res = await rpc<ParsedTxResult | null>(ctx, {
      method: 'getTransaction',
      params: [
        signature,
        { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ],
    });
    return mapTransaction(signature, res, null);
  },

  async getMintAccount(ctx, mint): Promise<MintAccountInfo> {
    const res = await rpc<{ context?: { slot?: number }; value?: Record<string, unknown> | null }>(ctx, {
      method: 'getAccountInfo',
      params: [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }],
    });
    const value = res?.value ?? null;
    if (!value) {
      throw new AppError('not_found', 'Mint account not found on this cluster.', { providerId: 'rpc' });
    }
    const parsed = asParsedInfo(value);
    return {
      address: mint,
      decimals: n(parsed?.decimals),
      supply: n(parsed?.supply),
      mintAuthority: str(parsed?.mintAuthority) ?? null,
      freezeAuthority: str(parsed?.freezeAuthority) ?? null,
      programOwner: str(value.owner) ?? null,
      isInitialized: typeof parsed?.isInitialized === 'boolean' ? parsed.isInitialized : null,
    };
  },
};

function asParsedInfo(value: Record<string, unknown>): Record<string, unknown> | null {
  const data = value.data;
  if (data && typeof data === 'object') {
    const parsed = (data as { parsed?: { info?: Record<string, unknown> } }).parsed;
    if (parsed?.info) return parsed.info;
  }
  return null;
}

export const _rpcInternals = {
  SYSTEM_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
};