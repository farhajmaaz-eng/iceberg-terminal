export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

export const NATIVE_SOL_MINT = SOL_MINT;

export const KNOWN_TOKENS: Record<string, { symbol: string; name: string; decimals: number }> = {
  [SOL_MINT]: { symbol: 'SOL', name: 'Wrapped SOL', decimals: 9 },
  [USDC_MINT]: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  [USDT_MINT]: { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
};

export const COIN_IDS: Record<string, string> = {
  solana: 'solana',
  [SOL_MINT]: 'solana',
  [USDC_MINT]: 'usd-coin',
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
};

/** Stablecoin-ish mints we can price without an extra lookup. */
export const STABLE_MINTS = new Set<string>([USDC_MINT, USDT_MINT]);