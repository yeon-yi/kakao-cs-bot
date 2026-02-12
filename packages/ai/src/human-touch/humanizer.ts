import { createLogger } from '@kakao-cs-bot/config';
import { getEnv } from '@kakao-cs-bot/config';

const logger = createLogger('ai:humanizer');

export class Humanizer {
  private dailyEmojiCount = 0;
  private lastEmojiReset = new Date().toDateString();

  normalRandom(mean: number, stddev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stddev * normal;
  }

  async getReadingDelay(messageLength: number): Promise<number> {
    // 50-90ms per character
    const msPerChar = Math.random() * 40 + 50;
    return Math.max(500, messageLength * msPerChar);
  }

  async getTypingDelay(responseLength: number): Promise<number> {
    // 80-130ms per character
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

  humanizeResponse(text: string, context?: { isThankYou?: boolean }): string {
    // Remove overly casual elements
    let result = text.replace(/습니당|해용|~~/g, '');
    result = result.replace(/ㅋㅋ|ㅎㅎ|\^\^/g, '');

    // Vary sentence endings (10% chance)
    if (Math.random() < 0.1) {
      result = result.replace(/습니다\./g, '해요.');
    }

    // Very limited emoji (max 2 per day)
    const today = new Date().toDateString();
    if (today !== this.lastEmojiReset) {
      this.dailyEmojiCount = 0;
      this.lastEmojiReset = today;
    }

    if (this.dailyEmojiCount < 2 && Math.random() < 0.2 && context?.isThankYou) {
      result += ' 🙏';
      this.dailyEmojiCount++;
    }

    return result;
  }

  splitIntoMessages(text: string): string[] {
    // Sometimes split long responses into multiple messages
    if (text.length < 100 || Math.random() > 0.3) return [text];

    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length <= 1) return [text];

    // Split into 2 messages
    const mid = Math.floor(sentences.length / 2);
    return [
      sentences.slice(0, mid).join(' '),
      sentences.slice(mid).join(' '),
    ];
  }
}

export const humanizer = new Humanizer();
