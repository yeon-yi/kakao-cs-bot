import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { IdentityRepository } from '@kakao-cs-bot/database';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:identity');
const identityRepo = new IdentityRepository();

// Nickname patterns for role detection
const STAFF_PATTERNS = [
  /팀장|부장|과장|대리|사원|매니저|실장|차장|본부장|이사/,
  /담당|운영|관리/,
];

export const identityRouter = router({
  identify: publicProcedure
    .input(z.object({
      kakaoUserId: z.string(),
      kakaoName: z.string(),
      roomId: z.string(),
      profileImage: z.string().optional(),
      statusMessage: z.string().optional(),
      messageHistory: z.array(z.string()).optional(),
    }))
    .query(async ({ input }) => {
      // 1. Check whitelist (company_staff table)
      const staff = await identityRepo.findStaffByKakaoId(input.kakaoUserId);
      if (staff) {
        return {
          role: 'COMPANY_STAFF' as const,
          confidence: 1.0,
          method: 'WHITELIST' as const,
          shouldConfirm: false,
          explanation: `화이트리스트 확인: ${staff.real_name}`,
        };
      }

      // Check by alias
      const alias = await identityRepo.findStaffByAlias(input.kakaoName);
      if (alias) {
        return {
          role: 'COMPANY_STAFF' as const,
          confidence: 0.9,
          method: 'WHITELIST' as const,
          shouldConfirm: false,
          explanation: `별칭 매칭: ${input.kakaoName}`,
        };
      }

      // 2. Check existing room member
      const member = await identityRepo.getRoomMember(input.roomId, input.kakaoUserId);
      if (member && member.role !== 'unknown') {
        return {
          role: member.role.toUpperCase() as any,
          confidence: member.confidence,
          method: 'BEHAVIOR_PATTERN' as const,
          shouldConfirm: member.confidence < 0.8,
          explanation: `기존 기록: ${member.role}`,
        };
      }

      // 3. Nickname pattern analysis
      for (const pattern of STAFF_PATTERNS) {
        if (pattern.test(input.kakaoName)) {
          await identityRepo.upsertRoomMember(input.roomId, input.kakaoUserId, input.kakaoName, 'company_staff', 0.85);
          return {
            role: 'COMPANY_STAFF' as const,
            confidence: 0.85,
            method: 'NICKNAME_PATTERN' as const,
            shouldConfirm: true,
            explanation: `닉네임 패턴 감지: ${input.kakaoName}`,
          };
        }
      }

      // 4. Unknown - register and request confirmation
      await identityRepo.upsertRoomMember(input.roomId, input.kakaoUserId, input.kakaoName, 'unknown', 0.5);
      return {
        role: 'UNKNOWN' as const,
        confidence: 0.5,
        method: 'UNKNOWN' as const,
        shouldConfirm: true,
        explanation: '신원 미확인',
      };
    }),

  register: protectedProcedure
    .input(z.object({
      kakaoUserId: z.string().optional(),
      kakaoName: z.string().optional(),
      realName: z.string().min(1),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      department: z.string().optional(),
      position: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await identityRepo.registerStaff({
        kakao_user_id: input.kakaoUserId,
        kakao_name: input.kakaoName,
        real_name: input.realName,
        email: input.email,
        phone: input.phone,
        department: input.department,
        position: input.position,
        added_by: ctx.userId,
      });
      logger.info('Staff registered', { id: result.id, name: input.realName });
      return { success: true, id: result.id };
    }),

  confirm: protectedProcedure
    .input(z.object({
      userId: z.string(),
      roomId: z.string(),
      role: z.enum(['COMPANY_STAFF', 'ADVERTISER', 'PARTNER']),
    }))
    .mutation(async ({ input, ctx }) => {
      await identityRepo.confirmIdentity(
        input.userId,
        input.roomId,
        input.role.toLowerCase(),
        ctx.userId!,
      );
      return { success: true, message: '신원이 확인되었습니다' };
    }),

  listUnknown: protectedProcedure
    .query(async () => {
      return identityRepo.listUnconfirmed();
    }),

  listMembers: protectedProcedure
    .input(z.object({
      role: z.string().optional(),
      search: z.string().optional(),
      offset: z.number().default(0),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      return identityRepo.listMembers(input);
    }),

  nameCollisions: protectedProcedure
    .query(async () => {
      return identityRepo.getNameCollisions();
    }),
});
