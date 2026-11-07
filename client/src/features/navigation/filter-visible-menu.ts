export interface PermissionSnapshotModule {
  moduleKey: string;
  permissions: readonly string[];
}

export interface PermissionLink {
  kind: "link";
  key: string;
  href: string;
  moduleKey: string;
  requiredPermissions: readonly string[];
}

export interface PermissionGroup<L extends PermissionLink = PermissionLink> {
  kind: "group";
  key: string;
  children: readonly L[];
}

export type PermissionMenuItem<L extends PermissionLink = PermissionLink> = L | PermissionGroup<L>;

const isValidLink = (
  link: PermissionLink,
  knownPermissions: Readonly<Record<string, readonly string[]>>,
): boolean => {
  if (!link.key || !link.href.startsWith('/') || !link.moduleKey || link.requiredPermissions.length === 0) return false;
  const known = knownPermissions[link.moduleKey];
  return !!known && link.requiredPermissions.every((permission) => known.includes(permission));
};

/** 精確比對同 module 的完整 permission；獨立項、子項與空群組一律 fail closed。 */
export function filterVisibleMenu<T extends PermissionMenuItem>(
  menu: readonly T[],
  modules: readonly PermissionSnapshotModule[],
  knownPermissions: Readonly<Record<string, readonly string[]>>,
): T[] {
  const permissionSets = new Map(
    modules.map((entry) => [entry.moduleKey, new Set(entry.permissions)] as const),
  );
  const keyCounts = new Map<string, number>();
  for (const item of menu) {
    keyCounts.set(item.key, (keyCounts.get(item.key) ?? 0) + 1);
    if (item.kind === "group") {
      for (const child of item.children) {
        keyCounts.set(child.key, (keyCounts.get(child.key) ?? 0) + 1);
      }
    }
  }

  const visible = menu.flatMap((item) => {
    if (!item.key || keyCounts.get(item.key) !== 1) return [];
    if (item.kind === "link") {
      if (!isValidLink(item, knownPermissions)) return [];
      const granted = permissionSets.get(item.moduleKey);
      return granted && item.requiredPermissions.every((permission) => granted.has(permission))
        ? [item]
        : [];
    }

    const children = item.children.filter((child) => {
      if (keyCounts.get(child.key) !== 1 || !isValidLink(child, knownPermissions)) return false;
      const granted = permissionSets.get(child.moduleKey);
      return !!granted && child.requiredPermissions.every((permission) => granted.has(permission));
    });
    return children.length ? [{ ...item, children }] : [];
  });

  return visible as T[];
}
