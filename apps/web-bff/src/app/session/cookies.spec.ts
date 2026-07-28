import { readCookie } from './cookies';

describe('readCookie', () => {
  it('finds a cookie among several', () => {
    expect(
      readCookie('a=1; helpdesk_refresh=abc.def; b=2', 'helpdesk_refresh'),
    ).toBe('abc.def');
  });

  it('decodes URI-encoded values', () => {
    expect(readCookie('token=a%2Eb', 'token')).toBe('a.b');
  });

  it('does not confuse prefixes with exact names', () => {
    expect(readCookie('helpdesk_refresh_old=x; y=z', 'helpdesk_refresh')).toBe(
      undefined,
    );
  });

  it('handles a missing header and a missing cookie', () => {
    expect(readCookie(undefined, 'any')).toBeUndefined();
    expect(readCookie('a=1', 'missing')).toBeUndefined();
  });
});
