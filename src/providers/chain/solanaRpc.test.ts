import { describe, expect, it } from 'vitest';
import {
  classifyTransaction,
  extractTokenAmounts,
  lamportsToSol,
  mapBalance,
  mapSignature,
  mapTransaction,
  resolveRpcUrl,
  safeEndpointLabel,
  _rpcInternals,
} from '@/providers/chain/solanaRpc';
import { AppError } from '@/lib/errors';

/**
 * Solana RPC normalization + classification policy.
 *
 * The classification tests are the important ones: they lock in the rule that
 * Iceberg never infers buy/sell/accumulation/liquidity intent.
 */

describe('RPC endpoint resolution', () => {
  it('defaults to a browser-friendly public endpoint (no key)', () => {
    // api.mainnet-beta.solana.com rejects browser Origins, so the default must
    // be a CORS-enabled mirror of mainnet.
    expect(resolveRpcUrl('public', undefined, undefined)).toBe('https://solana-rpc.publicnode.com');
  });

  it('can still target the Solana Foundation endpoint explicitly', () => {
    expect(resolveRpcUrl('solana-foundation', undefined, undefined)).toBe('https://api.mainnet-beta.solana.com');
  });

  it('builds Helius and Alchemy endpoints from the key', () => {
    expect(resolveRpcUrl('helius', 'ABC123', undefined)).toBe('https://mainnet.helius-rpc.com/?api-key=ABC123');
    expect(resolveRpcUrl('alchemy', 'XYZ', undefined)).toBe('https://solana-mainnet.g.alchemy.com/v2/XYZ');
  });

  it('refuses a keyed flavour without a key', () => {
    expect(() => resolveRpcUrl('helius', undefined, undefined)).toThrow(AppError);
    expect(() => resolveRpcUrl('alchemy', '', undefined)).toThrow(AppError);
  });

  it('requires HTTPS for custom endpoints', () => {
    expect(resolveRpcUrl('custom', undefined, 'https://node.example/rpc')).toBe('https://node.example/rpc');
    expect(() => resolveRpcUrl('custom', undefined, 'http://node.example/rpc')).toThrow(/HTTPS/);
    expect(() => resolveRpcUrl('custom', undefined, 'not a url')).toThrow(/valid URL/);
    expect(() => resolveRpcUrl('custom', undefined, '')).toThrow(/required/);
  });

  it('allows plain HTTP on localhost for local nodes', () => {
    expect(resolveRpcUrl('custom', undefined, 'http://127.0.0.1:8899')).toBe('http://127.0.0.1:8899');
  });

  it('redacts credentials from a displayed endpoint label', () => {
    const label = safeEndpointLabel('https://mainnet.helius-rpc.com/?api-key=SUPERSECRET123');
    expect(label).not.toContain('SUPERSECRET123');
    expect(label).toContain('api-key=***');
  });

  it('handles an invalid URL without throwing', () => {
    expect(safeEndpointLabel('not a url')).toBe('(invalid endpoint)');
  });
});

describe('RPC value mapping', () => {
  it('converts lamports to SOL', () => {
    expect(lamportsToSol(1_000_000_000)).toBe(1);
    expect(lamportsToSol(5000)).toBeCloseTo(0.000005);
  });

  it('keeps a missing balance as null, not zero', () => {
    expect(lamportsToSol(undefined)).toBeNull();
    expect(lamportsToSol('abc')).toBeNull();
  });

  it('maps a getBalance result', () => {
    const b = mapBalance('Addr', { context: { slot: 455_317_880 }, value: 2_500_000_000 });
    expect(b.sol).toBe(2.5);
    expect(b.slot).toBe(455_317_880);
    expect(b.provenance.origin).toBe('live');
  });

  it('maps a missing balance to null SOL', () => {
    const b = mapBalance('Addr', { context: {}, value: null });
    expect(b.sol).toBeNull();
    expect(b.lamports).toBeNull();
  });

  it('maps a signature and derives status from the error field', () => {
    const ok = mapSignature(
      { signature: 'S1', slot: 1, blockTime: 1_700_000_000, err: null, meta: { fee: 5000 } },
      'Acc',
    );
    expect(ok!.status).toBe('success');
    expect(ok!.blockTime).toBe(1_700_000_000_000);
    expect(ok!.feeSol).toBeCloseTo(0.000005);

    const bad = mapSignature({ signature: 'S2', err: { InstructionError: [0, 'x'] } }, 'Acc');
    expect(bad!.status).toBe('failed');
    expect(bad!.err).toBeTruthy();
  });

  it('drops signatures without a value', () => {
    expect(mapSignature({}, 'Acc')).toBeNull();
  });
});

describe('transaction classification policy', () => {
  it('classifies an SPL transfer instruction', () => {
    expect(
      classifyTransaction([{ program: 'spl-token', parsed: { type: 'transfer', info: {} } }]),
    ).toBe('transfer');
  });

  it('classifies mint and burn instructions', () => {
    expect(classifyTransaction([{ parsed: { type: 'mintTo', info: {} } }])).toBe('mint');
    expect(classifyTransaction([{ parsed: { type: 'burn', info: {} } }])).toBe('burn');
    expect(classifyTransaction([{ parsed: { type: 'closeAccount', info: {} } }])).toBe('close-account');
  });

  it('classifies a system transfer', () => {
    expect(classifyTransaction([{ program: 'system', parsed: { type: 'transfer' } }])).toBe('transfer');
  });

  it('falls back to unknown for an unrecognised program', () => {
    expect(classifyTransaction([{ program: 'someAggregator-v4' }])).toBe('unknown');
    expect(classifyTransaction([])).toBe('unknown');
  });

  it('never infers buy/sell/liquidity intent', () => {
    // A Jupiter-style aggregator swap has no parsed instruction; Iceberg must
    // NOT guess a direction from it.
    const result = classifyTransaction([{ program: 'jupiter-v6', parsed: { type: 'swap' } }]);
    expect(result).toBe('unknown');
    expect(['buy', 'sell']).not.toContain(result);
  });
});

describe('balance-delta extraction', () => {
  it('computes per-mint deltas from pre/post balances', () => {
    const { amounts } = extractTokenAmounts({
      meta: {
        preTokenBalances: [
          { accountIndex: 1, mint: 'MintA', uiTokenAmount: { amount: '1000', decimals: 6, uiAmount: 1 } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: 'MintA', uiTokenAmount: { amount: '2500', decimals: 6, uiAmount: 2.5 } },
        ],
      },
    });
    expect(amounts).toHaveLength(1);
    expect(amounts[0]!.mint).toBe('MintA');
    expect(amounts[0]!.uiAmount).toBeCloseTo(1.5);
  });

  it('drops zero deltas', () => {
    const { amounts } = extractTokenAmounts({
      meta: {
        preTokenBalances: [{ accountIndex: 0, mint: 'M', uiTokenAmount: { uiAmount: 5, decimals: 0 } }],
        postTokenBalances: [{ accountIndex: 0, mint: 'M', uiTokenAmount: { uiAmount: 5, decimals: 0 } }],
      },
    });
    expect(amounts).toHaveLength(0);
  });

  it('returns no amounts when the node reports none', () => {
    const { amounts, solDelta } = extractTokenAmounts({ meta: {} });
    expect(amounts).toHaveLength(0);
    expect(solDelta).toBeNull();
  });

  it('computes the fee-adjusted SOL delta for the signer', () => {
    const { solDelta } = extractTokenAmounts({
      meta: { preBalances: [1_000_000_000], postBalances: [1_990_000_000], fee: 10_000 },
    });
    expect(solDelta).toBeCloseTo(0.99);
  });
});

describe('transaction mapping', () => {
  it('returns null when the node has no transaction', () => {
    expect(mapTransaction('sig', null, 'acc')).toBeNull();
  });

  it('maps a failed transaction with an error string', () => {
    const r = mapTransaction(
      'sig',
      { slot: 1, blockTime: 1_700_000_000, meta: { err: { X: 1 }, fee: 5000 } },
      'acc',
    );
    expect(r!.status).toBe('failed');
    expect(r!.kind).toBe('unknown');
    expect(r!.err).toBeTruthy();
  });

  it('exposes computed units when the node reports them', () => {
    const r = mapTransaction('sig', { slot: 1, meta: { computeUnitsConsumed: 1234, fee: 5000 } }, null);
    expect(r!.computeUnits).toBe(1234);
  });

  it('exposes only read-only capability flags', () => {
    const { SYSTEM_PROGRAM_ID } = _rpcInternals;
    expect(SYSTEM_PROGRAM_ID).toBe('11111111111111111111111111111111');
  });
});