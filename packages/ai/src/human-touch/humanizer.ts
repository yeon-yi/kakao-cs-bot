import { createLogger } from '@kakao-cs-bot/config';
import { getEnv } from '@kakao-cs-bot/config';

const logger = createLogger('ai:humanizer');

interface HumanizeContext {
  isThankYou?: boolean;
  customerMessage?: string;
  hasHistory?: boolean;
}

type CustomerTone = 'angry' | 'urgent' | 'normal' | 'thankful';

export class Humanizer {
  private dailyEmojiCount = 0;
  private lastEmojiReset = new Date().toDateString();
  private lastEndingUsed = '';
  private consecutiveNoEmoji = 0;

  // ===================== 딜레이 계산 =====================

  normalRandom(mean: number, stddev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stddev * normal;
  }

  async getReadingDelay(messageLength: number): Promise<number> {
    const msPerChar = Math.random() * 40 + 50;
    return Math.max(500, messageLength * msPerChar);
  }

  async getTypingDelay(responseLength: number): Promise<number> {
    const msPerChar = Math.random() * 50 + 80;
    return Math.max(1000, responseLength * msPerChar);
  }

  getResponseDelay(): number {
    const env = getEnv();
    return this.normalRandom(
      (env.MIN_RESPONSE_DELAY + env.MAX_RESPONSE_DELAY) / 2,
      (env.MAX_RESPONSE_DELAY - env.MIN_RESPONSE_DELAY) / 4,
    );
  }

  isOperatingHours(): boolean {
    const env = getEnv();
    const tz = env.OPERATION_TIMEZONE || 'Asia/Seoul';
    const nowStr = new Date().toLocaleString('en-US', { timeZone: tz });
    const now = new Date(nowStr);
    const [startH, startM] = env.OPERATION_START_TIME.split(':').map(Number);
    const [endH, endM] = env.OPERATION_END_TIME.split(':').map(Number);
    const hour = now.getHours();
    const minute = now.getMinutes();
    const current = hour * 60 + minute;
    const start = startH * 60 + startM;
    const end = endH * 60 + endM;
    return current >= start && current <= end;
  }

  // ===================== 톤 분석 =====================

  analyzeTone(message: string): CustomerTone {
    const hasSarcasm = /고맙네|감사하네|덕분에.*떨어|덕분에.*줄|고마워서|:\)|잘\s*하시네|대단하시|참\s*잘/.test(message)
      || (/감사|고맙/.test(message) && /떨어지|줄었|손해|피해|매출|지켜볼|두고\s*보|가만/.test(message));

    if (hasSarcasm) return 'angry';
    if (/왜\s|대체|아직도|언제까지|짜증|화나|!!!|씨발|개[새씹]|어이없|어처구니|미치|열받|빡|지랄/.test(message)) return 'angry';
    if (/급해|빨리|지금\s*당장|즉시|긴급|ASAP/.test(message)) return 'urgent';
    if (/감사|고맙|ㄱㅅ|수고/.test(message) && !/떨어|줄었|손해|피해|지켜볼|두고\s*보/.test(message)) return 'thankful';
    return 'normal';
  }

  // ===================== 프로페셔널 인간화 =====================

  humanizeResponse(text: string, context?: HumanizeContext): string {
    let result = text;

    // 1. AI 특유의 패턴 제거
    result = this.removeAIPatterns(result);

    // 2. 프로페셔널 문장 종결 통일 (~요 → ~습니다 체)
    result = this.professionalizeEndings(result);

    // 3. 톤 기반 미세 조정
    let tone: CustomerTone = 'normal';
    if (context?.customerMessage) {
      tone = this.analyzeTone(context.customerMessage);
      result = this.adjustForTone(result, tone);
    }

    // 4. 문장 종결 미세 변형 (자연스러움)
    result = this.varySentenceEndings(result);

    // 5. 상황별 이모지 (프로페셔널하게)
    result = this.addProfessionalEmoji(result, context, tone);

    return result.trim();
  }

  // AI 특유의 패턴 제거
  private removeAIPatterns(text: string): string {
    let result = text;

    // 과도한 캐주얼 표현 제거
    result = result.replace(/습니당|해용|~~|ㅋㅋ+|ㅎㅎ+|\^\^/g, '');

    // AI 특유의 "~에 대해 말씀드리겠습니다" 도입부 제거
    result = result.replace(/^(네,?\s*)?(?:말씀하신|문의하신)\s*(?:내용에?\s*)?(?:대해|관련하여)\s*(?:답변|안내)\s*드리겠습니다\.?\s*/i, '');

    // "도움이 되셨으면 좋겠습니다" 등 로봇적 마무리 제거
    result = result.replace(/\s*(?:도움이 (?:되셨으면|되시길)\s*(?:좋겠습니다|바랍니다)|추가\s*(?:문의|질문)\s*(?:있으시면|사항이)\s*(?:편하게\s*)?(?:말씀해?\s*주세요|연락\s*주세요))[.!]?\s*$/i, '');

    // "물론입니다", "당연하죠" 등 AI 특유의 과잉 동의 제거
    result = result.replace(/^(?:물론입니다[.!]?\s*|당연하죠[.!]?\s*|물론이죠[.!]?\s*)/i, '');

    // "~에 대해 알려드리겠습니다" 형식적 도입부 제거
    result = result.replace(/^(?:.*에 대해\s*(?:알려|안내|설명)\s*드리겠습니다\.?\s*)/i, '');

    // "감사합니다" 중복 제거 (마지막에 하나만 남기기)
    const thankMatches = result.match(/감사합니다/g);
    if (thankMatches && thankMatches.length > 1) {
      let count = 0;
      result = result.replace(/감사합니다/g, (match) => {
        count++;
        return count < thankMatches.length ? '' : match;
      });
    }

    // 빈 줄 정리
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
  }

  // ~요 체 → ~습니다 체로 프로페셔널하게
  private professionalizeEndings(text: string): string {
    let result = text;

    result = result.replace(/드릴게요/g, '드리겠습니다');
    result = result.replace(/([가-힣])할게요/g, '$1하겠습니다');
    result = result.replace(/알려드릴게요/g, '알려드리겠습니다');
    result = result.replace(/해드릴게요/g, '해드리겠습니다');
    result = result.replace(/인데요([.!?]\s|[.!?]?$)/gm, '입니다$1');
    result = result.replace(/거든요([.!?]\s|[.!?]?$)/gm, '것입니다$1');
    result = result.replace(/있어요/g, '있습니다');
    result = result.replace(/없어요/g, '없습니다');
    result = result.replace(/돼요|되요/g, '됩니다');
    result = result.replace(/에요([.!?]?\s|[.!?]?$)/g, '입니다$1');

    return result;
  }

  // 고객 톤에 맞춘 미세 조정
  private adjustForTone(text: string, tone: CustomerTone): string {
    switch (tone) {
      case 'angry': {
        if (!/죄송|불편|사과/.test(text)) {
          const apologies = [
            '불편을 드려 죄송합니다. ',
            '불편하셨을 텐데 죄송합니다. ',
            '이 부분 불편하셨겠습니다. ',
          ];
          return apologies[Math.floor(Math.random() * apologies.length)] + text;
        }
        return text;
      }

      case 'urgent':
        if (!/바로|즉시|빠르게|신속/.test(text)) {
          const urgents = [
            ', 빠르게 처리하겠습니다.',
            ', 바로 확인해보겠습니다.',
            ', 신속하게 처리해드리겠습니다.',
          ];
          return text.replace(/\.$/, urgents[Math.floor(Math.random() * urgents.length)]);
        }
        return text;

      case 'thankful':
        if (text.length > 100) {
          const sentences = text.split(/(?<=[.!])\s+/);
          if (sentences.length > 2) {
            return sentences.slice(0, 2).join(' ');
          }
        }
        return text;

      default:
        return text;
    }
  }

  // 문장 종결 미세 변형 (같은 종결이 연속되지 않도록)
  private varySentenceEndings(text: string): string {
    const sentences = text.split(/(?<=[.!])\s+/);
    if (sentences.length <= 1) return text;

    let prevEnding = '';
    const varied = sentences.map((s, i) => {
      if (i === sentences.length - 1) return s;

      const currentEnding = s.match(/(합니다|겠습니다|있습니다|됩니다|바랍니다)\./)?.[1] || '';
      if (currentEnding && currentEnding === prevEnding && Math.random() < 0.5) {
        const alternates: Record<string, string[]> = {
          '합니다': ['드립니다', '사항입니다'],
          '겠습니다': ['드리겠습니다', '하겠습니다'],
          '있습니다': ['있으십니다', '가능합니다'],
          '됩니다': ['가능합니다', '됩니다'],
          '바랍니다': ['드리겠습니다', '부탁드립니다'],
        };
        const alts = alternates[currentEnding];
        if (alts) {
          const alt = alts[Math.floor(Math.random() * alts.length)];
          s = s.replace(currentEnding + '.', alt + '.');
        }
      }
      prevEnding = currentEnding;
      return s;
    });

    return varied.join(' ');
  }

  // 상황별 이모지 (프로페셔널 - 하루 5개, 15% 확률, 연속 사용 금지)
  private addProfessionalEmoji(text: string, _context?: HumanizeContext, tone?: CustomerTone): string {
    const today = new Date().toDateString();
    if (today !== this.lastEmojiReset) {
      this.dailyEmojiCount = 0;
      this.lastEmojiReset = today;
      this.consecutiveNoEmoji = 0;
    }

    if (this.dailyEmojiCount >= 5) return text;

    // 화난 고객에게는 이모지 사용 안 함
    if (tone === 'angry') return text;

    // 기본 15% 확률, 연속 미사용 시 확률 증가 (자연스러운 분포)
    const prob = Math.min(0.15 + this.consecutiveNoEmoji * 0.05, 0.4);
    if (Math.random() > prob) {
      this.consecutiveNoEmoji++;
      return text;
    }

    // 문맥에 맞는 이모지 선택
    const emojiMap: [RegExp, string[]][] = [
      [/안내|알려|설명/, ['📌', '💡']],
      [/확인|완료|처리/, ['✅', '👍']],
      [/감사|고맙/, ['🙏', '😊']],
      [/기다려|잠시/, ['🙏']],
      [/죄송|불편/, ['🙏']],
      [/진행|시작|준비/, ['👍']],
    ];

    for (const [pattern, emojis] of emojiMap) {
      if (pattern.test(text)) {
        this.dailyEmojiCount++;
        this.consecutiveNoEmoji = 0;
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        return text + ' ' + emoji;
      }
    }

    this.consecutiveNoEmoji++;
    return text;
  }

  // ===================== 메시지 분할 =====================

  splitIntoMessages(text: string): { text: string; delay: number }[] {
    // 짧은 메시지는 분할하지 않음
    if (text.length < 120) return [{ text, delay: 0 }];

    // 30% 확률로만 분할
    if (Math.random() > 0.3) return [{ text, delay: 0 }];

    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length <= 2) return [{ text, delay: 0 }];

    // 자연스러운 분할점 찾기
    for (let i = 1; i < sentences.length; i++) {
      const s = sentences[i];
      if (/^(참고로|추가로|다만|그리고|아울러|또한|아 그리고|그런데)/.test(s)) {
        return [
          { text: sentences.slice(0, i).join(' '), delay: 0 },
          { text: sentences.slice(i).join(' '), delay: 1500 + Math.random() * 2000 },
        ];
      }
    }

    // 기본: 중간 지점에서 분할
    const mid = Math.floor(sentences.length / 2);
    return [
      { text: sentences.slice(0, mid).join(' '), delay: 0 },
      { text: sentences.slice(mid).join(' '), delay: 1500 + Math.random() * 2000 },
    ];
  }
}

export const humanizer = new Humanizer();
