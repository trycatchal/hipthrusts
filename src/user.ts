export function assigneeCheckersOnIdKey<TPrincipalIdKey extends string>(
  principalIdKey: TPrincipalIdKey
) {
  return {
    idOnKeyIs<TIdKey extends string>(idKey: TIdKey) {
      return function <TPrincipal extends Record<TPrincipalIdKey, string>>(
        this: Record<TIdKey, string>,
        principal: TPrincipal
      ) {
        return (
          principal &&
          this &&
          principal[principalIdKey] &&
          this[idKey] &&
          principal[principalIdKey].toString() === this[idKey].toString()
        );
      };
    },
  };
}

export function roleCheckersOnRoleKey<TRoleKey extends string>(
  roleKey: TRoleKey
) {
  return {
    roleIsOneOf(roles: string[]) {
      return function checker(principal: Record<TRoleKey, string>) {
        return (
          roles &&
          roles.length &&
          principal &&
          principal[roleKey] &&
          roles.includes(principal[roleKey])
        );
      };
    },
    oneOfRolesIsOneOf(roles: string[]) {
      return function checker(principal: Record<TRoleKey, string[]>) {
        if (
          roles &&
          roles.length &&
          principal &&
          principal[roleKey] &&
          principal[roleKey].length
        ) {
          for (const roleIdx in roles) {
            if (principal[roleKey].includes(roles[roleIdx])) {
              return true;
            }
          }
        }
        return false;
      };
    },
  };
}
