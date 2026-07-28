import {
  composeRefreshToken,
  generateRefreshSecret,
  hashRefreshSecret,
  parseRefreshToken,
  refreshHashesMatch,
} from './refresh-token.codec';

describe('refresh token codec', () => {
  it('round-trips compose and parse', () => {
    const id = '0f228672-164e-494d-860e-31de5a38cd51';
    const secret = generateRefreshSecret();

    const parsed = parseRefreshToken(composeRefreshToken(id, secret));

    expect(parsed).toEqual({ id, secret });
  });

  it('rejects malformed inputs', () => {
    expect(parseRefreshToken('')).toBeNull();
    expect(parseRefreshToken('no-separator')).toBeNull();
    expect(parseRefreshToken('.leading-dot')).toBeNull();
    expect(parseRefreshToken('trailing-dot.')).toBeNull();
    expect(parseRefreshToken('not-a-uuid.secret')).toBeNull();
  });

  it('generates distinct high-entropy secrets', () => {
    const a = generateRefreshSecret();
    const b = generateRefreshSecret();

    expect(a).not.toBe(b);
    // 32 random bytes in base64url encode to 43 characters.
    expect(a).toHaveLength(43);
  });

  it('matches only identical hashes, in constant time by construction', () => {
    const secret = generateRefreshSecret();
    const hash = hashRefreshSecret(secret);

    expect(refreshHashesMatch(hash, hashRefreshSecret(secret))).toBe(true);
    expect(
      refreshHashesMatch(hash, hashRefreshSecret(generateRefreshSecret())),
    ).toBe(false);
    expect(refreshHashesMatch(hash, 'zz')).toBe(false);
  });
});
