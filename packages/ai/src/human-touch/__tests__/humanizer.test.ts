import { describe, it, expect } from 'vitest';
import { Humanizer } from '../humanizer';

describe('Humanizer', () => {
  const humanizer = new Humanizer();

  describe('analyzeTone', () => {
    it('angry 톤 감지 - 욕설/불만', () => {
      expect(humanizer.analyzeTone('씨발 뭐가 이래')).toBe('angry');
      expect(humanizer.analyzeTone('왜 아직도 처리가 안 되는 거야')).toBe('angry');
      expect(humanizer.analyzeTone('짜증나네 진짜')).toBe('angry');
    });

    it('angry 톤 감지 - 빈정거림 (감사+불만)', () => {
      expect(humanizer.analyzeTone('고맙네 덕분에 매출 떨어졌어')).toBe('angry');
      expect(humanizer.analyzeTone('잘 하시네 정말')).toBe('angry');
    });

    it('urgent 톤 감지', () => {
      expect(humanizer.analyzeTone('급해요 빨리 해주세요')).toBe('urgent');
      expect(humanizer.analyzeTone('지금 당장 필요합니다')).toBe('urgent');
    });

    it('thankful 톤 감지', () => {
      expect(humanizer.analyzeTone('감사합니다')).toBe('thankful');
      expect(humanizer.analyzeTone('고맙습니다 수고하세요')).toBe('thankful');
    });

    it('thankful + 불만 키워드 = 빈정거림 = angry', () => {
      expect(humanizer.analyzeTone('감사하네 매출 떨어져서')).toBe('angry');
    });

    it('normal 톤 기본값', () => {
      expect(humanizer.analyzeTone('네이버 트래픽 서비스 문의합니다')).toBe('normal');
      expect(humanizer.analyzeTone('가격이 궁금합니다')).toBe('normal');
    });
  });

  describe('humanizeResponse - AI 패턴 제거', () => {
    it('과도한 캐주얼 표현 제거', () => {
      const result = humanizer.humanizeResponse('네 알겠습니당 ^^');
      expect(result).not.toContain('습니당');
      expect(result).not.toContain('^^');
    });

    it('AI 특유 도입부 제거', () => {
      const result = humanizer.humanizeResponse('말씀하신 내용에 대해 답변 드리겠습니다. 가격은 50만원입니다.');
      expect(result).not.toContain('말씀하신');
      expect(result).toContain('가격');
    });

    it('로봇적 마무리 제거', () => {
      const result = humanizer.humanizeResponse('가격은 50만원입니다. 도움이 되셨으면 좋겠습니다.');
      expect(result).not.toContain('도움이 되셨으면');
    });

    it('과잉 동의 제거', () => {
      const result = humanizer.humanizeResponse('물론입니다. 네이버 트래픽 서비스입니다.');
      expect(result).not.toContain('물론입니다');
      expect(result).toContain('네이버');
    });
  });

  describe('humanizeResponse - 격식체 변환', () => {
    it('~요 체 → ~습니다 체 (기본 formal)', () => {
      const result = humanizer.humanizeResponse('가격이 있어요.', { customerFormality: 'formal' });
      expect(result).toContain('있습니다');
    });

    it('casual 고객이면 ~요 체 유지', () => {
      const result = humanizer.humanizeResponse('드릴게요.', { customerFormality: 'casual' });
      expect(result).toContain('드릴게요');
    });
  });

  describe('splitIntoMessages', () => {
    it('80자 미만은 분할하지 않음', () => {
      const result = humanizer.splitIntoMessages('짧은 메시지입니다.');
      expect(result).toHaveLength(1);
      expect(result[0].delay).toBe(0);
    });

    it('반환 배열의 첫 메시지 delay는 0', () => {
      const longText = '첫 번째 문장입니다. 두 번째 문장입니다. 참고로 세 번째 문장이 있습니다. 네 번째 문장도 있고요. 다섯 번째 문장까지 있습니다.';
      const result = humanizer.splitIntoMessages(longText);
      expect(result[0].delay).toBe(0);
    });
  });

  describe('normalRandom', () => {
    it('통계적으로 평균 근처 값 생성', () => {
      const values: number[] = [];
      for (let i = 0; i < 100; i++) {
        values.push(humanizer.normalRandom(5000, 1000));
      }
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      expect(avg).toBeGreaterThan(3000);
      expect(avg).toBeLessThan(7000);
    });
  });
});
