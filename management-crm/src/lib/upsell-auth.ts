import { AuthPayload } from './auth';
import { UPSELLING_ROLES } from './constants';

const UPSELL_ROLES: readonly string[] = UPSELLING_ROLES;

/** 업셀링 역할인지 확인 */
export function isUpsellRole(role: string): boolean {
  return UPSELL_ROLES.includes(role);
}

/** 업셀링 권한 필수 체크 (admin도 허용) */
export function requireUpsellAuth(auth: AuthPayload): AuthPayload {
  if (!isUpsellRole(auth.role) && auth.role !== 'admin') {
    throw new Error('Forbidden');
  }
  return auth;
}

/** 상위 역할이 하위 역할 계정을 관리할 수 있는지 확인 */
export function canManageUpsellUser(managerRole: string, targetRole: string): boolean {
  if (managerRole === 'admin') return true;
  if (managerRole === 'upselling_director') {
    return targetRole === 'upselling_chief' || targetRole === 'upselling_staff';
  }
  if (managerRole === 'upselling_chief') {
    return targetRole === 'upselling_staff';
  }
  return false;
}

/** 생성 가능한 역할 목록 반환 */
export function getCreatableRoles(role: string): string[] {
  if (role === 'admin') return ['upselling_director', 'upselling_chief', 'upselling_staff'];
  if (role === 'upselling_director') return ['upselling_chief', 'upselling_staff'];
  if (role === 'upselling_chief') return ['upselling_staff'];
  return [];
}

/** 업체 분배 권한: 실장만 */
export function canDistribute(role: string): boolean {
  return role === 'admin' || role === 'upselling_director';
}

/** 전체 결제건 조회: 실장 + 주임 (사원은 분배받은 것만) */
export function canViewAllCompanies(role: string): boolean {
  return role === 'admin' || role === 'upselling_director' || role === 'upselling_chief';
}

/** 카드번호 조회: 간부급 이상 (실장/주임) */
export function canViewCardDetails(role: string): boolean {
  return role === 'admin' || role === 'upselling_director' || role === 'upselling_chief';
}
