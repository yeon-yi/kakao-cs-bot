export const ROLES = {
  ADMIN: 'admin',
  MANAGER_TEAM: 'manager_team',
  BRANCH_MANAGER: 'branch_manager',
  MANAGER: 'manager',
  STAFF: 'staff',
  UPSELLING_DIRECTOR: 'upselling_director',
  UPSELLING_CHIEF: 'upselling_chief',
  UPSELLING_STAFF: 'upselling_staff',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const UPSELLING_ROLES = [
  ROLES.UPSELLING_DIRECTOR,
  ROLES.UPSELLING_CHIEF,
  ROLES.UPSELLING_STAFF,
] as const;

export const ROLE_LABELS: Record<string, string> = {
  admin: '시스템관리자',
  manager_team: '관리팀',
  branch_manager: '지사장',
  manager: '간부',
  staff: '영업자',
  upselling_director: '업셀링 실장',
  upselling_chief: '업셀링 주임',
  upselling_staff: '업셀링 사원',
};

export const REVIEW_TYPE_LABELS: Record<string, string> = {
  receipt_only: '영수증리뷰만',
  kakao_only: '카카오리뷰만',
  both: '영수증+카카오',
};

export const CHANNEL_TYPE_LABELS: Record<string, string> = {
  none: '미선택',
  kakao_channel: '카카오채널',
  blog_skin: '블로그스킨',
};

export const BRANCHES = [
  '인천',
  '수원',
  '동탄',
  '용인',
  '부산',
  '본사',
] as const;

export type Branch = (typeof BRANCHES)[number];

export const BRANCH_MAP: Record<string, string> = {
  '인천마스터': '인천',
  '인천파링': '인천',
  '수원마스터': '수원',
  '수원플레이스': '수원',
  '동탄마스터': '동탄',
  '동탄플레이스': '동탄',
  '용인마스터': '용인',
  '용인플레이스': '용인',
  '부산마스터': '부산',
  '부산플레이스': '부산',
  '안산플레이스': '본사',
  'place1': '본사',
  '플레이스팀': '본사',
};

export function extractBranch(registrant: string): string {
  return BRANCH_MAP[registrant] || '본사';
}

export const VIDEO_TYPES: Record<string, string> = {
  none: '없음',
  premium: '프리미엄 영상',
  short: '일반 숏폼',
};

export const SOLUTION_LABELS: Record<string, string> = {
  reward: '리워드',
  blog: '블로그리뷰',
  insta: '인스타',
  homepage: '홈페이지',
  video: '영상제작',
};
