// SPDX-License-Identifier: Apache-2.0

export interface OptionalHostPermissionApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  remove(permissions: { origins: string[] }): Promise<boolean>;
}

export async function releaseOptionalHostPermission(
  permissions: OptionalHostPermissionApi,
  permissionPattern: string,
): Promise<boolean> {
  try {
    await permissions.remove({ origins: [permissionPattern] });
    return !(await permissions.contains({ origins: [permissionPattern] }));
  } catch {
    return false;
  }
}
