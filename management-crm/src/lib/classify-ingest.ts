import { RiskCaseType } from '@prisma/client';

interface IngestRow {
  id: number;
  subject: string;
  fromAddress: string;
  bodySnippet: string;
  bodyText: string | null;
}

interface ClassifyResult {
  caseType: RiskCaseType | null;
  businessName: string | null;
  skip: boolean; // true면 무시 (보안알림, Google Drive 등)
}

const IGNORE_SENDERS = [
  'drive-shares-dm-noreply@google.com',
  'no-reply@accounts.google.com',
  'noreply@google.com',
  'support@codepen.io',
];

const IGNORE_SUBJECTS = [
  '보안 알림',
  '공유 요청',
  'Google Drive',
  '로그인 알림',
];

// KG이니시스 = 카드민원
const KG_SENDER_PATTERN = /@kggroup\.co\.kr$/i;
const KG_SUBJECT_PATTERN = /이니시스.*민원|민원안내/i;

// 온라인광고분쟁조정위원회 = 기관민원
const INSTITUTION_SENDERS = ['odmc@kisa.or.kr'];
const INSTITUTION_SUBJECT_PATTERN = /분쟁조정|조정참여|종결통보|조정위원회/i;

// 해지방어 (취소 요청)
const CANCEL_SUBJECT_PATTERN = /취소\s*요청|취소\s*신청|해지.*요청|플랫폼.*취소|서비스.*취소/i;

// 업체명 추출
function extractBusinessName(subject: string, bodySnippet: string): string | null {
  // "XXX 취소 요청서" 패턴에서 업체명 추출
  const cancelMatch = subject.match(/^(.+?)\s*(?:취소|해지|플랫폼)/);
  if (cancelMatch) {
    const name = cancelMatch[1].replace(/^(?:RE:|FW:|Fwd:)\s*/i, '').trim();
    if (name.length >= 2 && name.length <= 50) return name;
  }

  // body snippet에서 업체명/상호명 추출
  const bodyMatch = bodySnippet.match(/(?:업체명|상호명|업장명|상호)\s*[:：]?\s*([^\n,]{2,30})/);
  if (bodyMatch) return bodyMatch[1].trim();

  return null;
}

export function classifyIngest(ingest: IngestRow): ClassifyResult {
  const { subject, fromAddress, bodySnippet, bodyText } = ingest;
  const fullBody = bodyText || bodySnippet;

  // 무시할 메일
  if (IGNORE_SENDERS.some(s => fromAddress.toLowerCase() === s)) {
    return { caseType: null, businessName: null, skip: true };
  }
  if (IGNORE_SUBJECTS.some(s => subject.includes(s))) {
    return { caseType: null, businessName: null, skip: true };
  }

  // 카드민원 (KG이니시스)
  if (KG_SENDER_PATTERN.test(fromAddress) || KG_SUBJECT_PATTERN.test(subject)) {
    return {
      caseType: 'card_complaint',
      businessName: extractBusinessName(subject, fullBody),
      skip: false,
    };
  }

  // 기관민원
  if (INSTITUTION_SENDERS.includes(fromAddress.toLowerCase()) || INSTITUTION_SUBJECT_PATTERN.test(subject)) {
    return {
      caseType: 'institution_complaint',
      businessName: extractBusinessName(subject, fullBody),
      skip: false,
    };
  }

  // 해지방어 — 제목에서 취소/해지 패턴, 본문에서는 더 구체적인 패턴만
  const CANCEL_BODY_PATTERN = /취소\s*(?:요청서|신청서)|해지\s*(?:요청서|신청서)|플랫폼\s*취소\s*요청/i;
  if (CANCEL_SUBJECT_PATTERN.test(subject) || CANCEL_BODY_PATTERN.test(fullBody)) {
    return {
      caseType: 'cancel_defense',
      businessName: extractBusinessName(subject, fullBody),
      skip: false,
    };
  }

  // 분류 불가 — 수동 처리 필요
  return { caseType: null, businessName: null, skip: false };
}
