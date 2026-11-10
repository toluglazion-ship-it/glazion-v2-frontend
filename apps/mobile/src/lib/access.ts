import { useQuery } from '@tanstack/react-query';
import { meApi } from '@glazion/api-client';
import { UserRole } from '@glazion/types';

/**
 * Whether the signed-in account is an admin. Only admins search by UMF or see the chemistry behind a match (meeting
 * 2026-10-29); the calculator stays for everyone, as it only works on the recipe they type. The API enforces it too.
 */
export function useIsAdmin(): boolean {
  const me = useQuery({ queryKey: ['me'], queryFn: meApi.get });
  return me.data?.role === UserRole.Admin;
}
