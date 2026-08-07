export interface Role { id: string; label: string; locked?: boolean }
export interface Permission { id: string; label: string; hint?: string; lockedFor?: string }
export interface RoleMatrixProps {
  roles: Role[];
  permissions: Permission[];
  /** value[permId][roleId] = boolean. */
  value: Record<string, Record<string, boolean>>;
  onToggle?: (permId: string, roleId: string) => void;
  readOnly?: boolean;
}
export declare function RoleMatrix(props: RoleMatrixProps): JSX.Element;
