/**
 * Centralized role-based permission configuration for all CRM modules.
 *
 * Role hierarchy (higher level = more authority):
 *   L4 super_admin > L3 admin/org > L2 manager > L1 sales rep / HR / marketing > student (0)
 */

import { canRoleManageRole, getRoleLevel, normalizeAppRole, ROLE_HIERARCHY_LEVELS } from "./roleUtils";

export const ROLE_HIERARCHY = ROLE_HIERARCHY_LEVELS;

export const CAN_CREATE_ROLES = [
  "super_admin",
  "admin",
  "org",
  "manager",
  "sales_representative",
];
export const CAN_EDIT_ALL_ROLES = ["super_admin", "admin", "org", "manager"];
export const CAN_DELETE_ROLES = ["super_admin", "admin", "org", "manager"];
export const CAN_BULK_DELETE_ROLES = ["super_admin", "admin", "org"];
export const CAN_IMPORT_ROLES = ["super_admin", "admin", "org", "manager"];
export const CAN_EXPORT_ROLES = [
  "super_admin",
  "admin",
  "org",
  "manager",
  "sales_representative",
  "trainer",
  "finance",
];

function roleKey(role: string | null): string {
  return normalizeAppRole(role);
}

export const canCreate = (role: string | null): boolean =>
  CAN_CREATE_ROLES.includes(roleKey(role));

export const canEditAll = (role: string | null): boolean =>
  CAN_EDIT_ALL_ROLES.includes(roleKey(role));

export const canDelete = (role: string | null): boolean =>
  CAN_DELETE_ROLES.includes(roleKey(role));

export const canBulkDelete = (role: string | null): boolean =>
  CAN_BULK_DELETE_ROLES.includes(roleKey(role));

export const canImport = (role: string | null): boolean =>
  CAN_IMPORT_ROLES.includes(roleKey(role));

export const canExport = (role: string | null): boolean =>
  CAN_EXPORT_ROLES.includes(roleKey(role));

export const canEditRecord = (
  role: string | null,
  userId: string | undefined,
  ownerId: string | null | undefined
): boolean => {
  if (canEditAll(role)) return true;
  return !!userId && userId === ownerId;
};

export const canDeleteRecord = (role: string | null): boolean => canDelete(role);

export const getHierarchyLevel = (role: string | null): number => getRoleLevel(role);

export const outranks = (currentRole: string | null, targetRole: string | null): boolean =>
  canRoleManageRole(currentRole, targetRole);

export const canManageByHierarchy = (
  currentUserId: string | undefined,
  currentRole: string | null,
  recordOwnerId: string | null | undefined,
  recordOwnerRole: string | null
): boolean => {
  if (currentUserId === recordOwnerId) return true;
  return outranks(currentRole, recordOwnerRole);
};
