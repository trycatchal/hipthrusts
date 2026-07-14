import { describe, expect, it } from 'vitest';
import { assigneeCheckersOnIdKey, roleCheckersOnRoleKey } from '../src/user';

describe('assigneeCheckersOnIdKey', () => {
  const { idOnKeyIs } = assigneeCheckersOnIdKey('userId');

  it('passes when the principal id matches the id on the bound key', () => {
    const checker = idOnKeyIs('ownerId');
    expect(checker.call({ ownerId: 'abc' }, { userId: 'abc' })).toBeTruthy();
  });

  it('fails when the ids differ', () => {
    const checker = idOnKeyIs('ownerId');
    expect(checker.call({ ownerId: 'abc' }, { userId: 'xyz' })).toBeFalsy();
  });

  it('fails when the principal is missing its id', () => {
    const checker = idOnKeyIs('ownerId');
    expect(checker.call({ ownerId: 'abc' }, {} as any)).toBeFalsy();
  });

  it('fails when the bound context is missing the id key', () => {
    const checker = idOnKeyIs('ownerId');
    expect(checker.call({} as any, { userId: 'abc' })).toBeFalsy();
  });

  it('coerces both sides with toString (ObjectId-style ids)', () => {
    const checker = idOnKeyIs('ownerId');
    const objectIdLike = { toString: () => 'abc' };
    expect(
      checker.call({ ownerId: objectIdLike } as any, {
        userId: 'abc',
      } as any)
    ).toBeTruthy();
  });
});

describe('roleCheckersOnRoleKey', () => {
  const { roleIsOneOf, oneOfRolesIsOneOf } = roleCheckersOnRoleKey('role');

  it('roleIsOneOf passes when the principal role is in the list', () => {
    expect(roleIsOneOf(['admin', 'editor'])({ role: 'admin' })).toBeTruthy();
  });

  it('roleIsOneOf fails when the principal role is not in the list', () => {
    expect(roleIsOneOf(['admin'])({ role: 'viewer' })).toBeFalsy();
  });

  it('roleIsOneOf fails on an empty allowed-roles list', () => {
    expect(roleIsOneOf([])({ role: 'admin' })).toBeFalsy();
  });

  it('roleIsOneOf fails when the principal has no role', () => {
    expect(roleIsOneOf(['admin'])({} as any)).toBeFalsy();
  });

  it('oneOfRolesIsOneOf passes when any principal role is allowed', () => {
    expect(
      oneOfRolesIsOneOf(['admin'])({ role: ['viewer', 'admin'] })
    ).toBe(true);
  });

  it('oneOfRolesIsOneOf fails when no principal role is allowed', () => {
    expect(oneOfRolesIsOneOf(['admin'])({ role: ['viewer'] })).toBe(false);
  });

  it('oneOfRolesIsOneOf fails on empty principal roles', () => {
    expect(oneOfRolesIsOneOf(['admin'])({ role: [] })).toBe(false);
  });

  it('oneOfRolesIsOneOf fails when the principal has no role key', () => {
    expect(oneOfRolesIsOneOf(['admin'])({} as any)).toBe(false);
  });
});
