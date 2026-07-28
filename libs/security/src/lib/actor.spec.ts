import { isAdmin, isStaff } from './actor.js';

describe('actor role predicates', () => {
  it('treats agents and admins as staff, plain users not', () => {
    expect(isStaff({ id: 'a', roles: ['agent'] })).toBe(true);
    expect(isStaff({ id: 'b', roles: ['admin'] })).toBe(true);
    expect(isStaff({ id: 'c', roles: ['user'] })).toBe(false);
    expect(isStaff({ id: 'd', roles: [] })).toBe(false);
  });

  it('reserves admin checks for the admin role alone', () => {
    expect(isAdmin({ id: 'a', roles: ['admin', 'agent'] })).toBe(true);
    expect(isAdmin({ id: 'b', roles: ['agent'] })).toBe(false);
    expect(isAdmin({ id: 'c', roles: ['user'] })).toBe(false);
  });
});
