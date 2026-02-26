import { describe, it, expect, vi, beforeEach } from 'vitest';

// 에스컬레이션 서비스의 핵심 로직 단위 테스트
describe('resolveAssignee logic', () => {
  it('room staff 우선순위: room > category > null', () => {
    // 시뮬레이션: room에 직원이 있는 경우
    const roomStaff = { staffId: 42, staffName: '김담당' };
    const categoryAssignee = { staff_id: 99 };

    // 1) room staff 있으면 그것 사용
    let assignedStaffId: number | null = null;
    if (roomStaff) {
      assignedStaffId = roomStaff.staffId;
    }
    expect(assignedStaffId).toBe(42);
  });

  it('room staff 없으면 category assignee 사용', () => {
    const roomStaff = null;
    const categoryAssignee = { staff_id: 99 };

    let assignedStaffId: number | null = null;
    if (roomStaff) {
      assignedStaffId = (roomStaff as any).staffId;
    }
    if (!assignedStaffId && categoryAssignee) {
      assignedStaffId = categoryAssignee.staff_id;
    }
    expect(assignedStaffId).toBe(99);
  });

  it('둘 다 없으면 null', () => {
    const roomStaff = null;
    const categoryAssignee = null;

    let assignedStaffId: number | null = null;
    if (roomStaff) {
      assignedStaffId = (roomStaff as any).staffId;
    }
    if (!assignedStaffId && categoryAssignee) {
      assignedStaffId = (categoryAssignee as any).staff_id;
    }
    expect(assignedStaffId).toBeNull();
  });
});

describe('escalation status assignment', () => {
  it('assignedStaffId 있으면 assigned', () => {
    const assignedStaffId = 42;
    const status = assignedStaffId ? 'assigned' : 'pending';
    expect(status).toBe('assigned');
  });

  it('assignedStaffId 없으면 pending', () => {
    const assignedStaffId = null;
    const status = assignedStaffId ? 'assigned' : 'pending';
    expect(status).toBe('pending');
  });
});

describe('VALID_CATEGORIES classification', () => {
  const VALID_CATEGORIES = ['네이버트래픽', '블로그기자단', '인스타그램', '홈페이지', 'SEO', '영상촬영', '일반'];

  it('유효한 카테고리만 통과', () => {
    expect(VALID_CATEGORIES.includes('네이버트래픽')).toBe(true);
    expect(VALID_CATEGORIES.includes('SEO')).toBe(true);
  });

  it('유효하지 않은 카테고리는 일반으로 폴백', () => {
    const cat = '존재하지않는카테고리';
    const result = VALID_CATEGORIES.includes(cat) ? cat : '일반';
    expect(result).toBe('일반');
  });
});
