/**
 * homejeonsan.ts - 모집플레이스.com(홈전산) 커넥터
 *
 * DupDBConnector.php를 Node.js fetch 기반으로 포팅.
 * 세션 쿠키 기반 인증, HTML 테이블 파싱으로 데이터 추출.
 */

import { prisma as db } from '@/lib/prisma';

// -- 상수 --

const BASE_URL = 'http://xn--om2b11cizk16enld46x.com';

const ENDPOINTS = {
  LOGIN: `${BASE_URL}/signin`,
  AUTH2: `${BASE_URL}/authin`,
  DUP_LIST: `${BASE_URL}/admin/place/dup/list/`,
  KEYWORD_LIST: `${BASE_URL}/admin/place/list/A`,
  KEYWORD_ADD: `${BASE_URL}/admin/place/add`,
  KEYWORD_DELETE: `${BASE_URL}/admin/place/delete/`,
  REPORT: `${BASE_URL}/admin/report`,
  REPORT_ADD: `${BASE_URL}/admin/report/add`,
  POST: `${BASE_URL}/admin/post`,
  POST_ADD: `${BASE_URL}/admin/post/add`,
  UPLOAD_IMAGE: `${BASE_URL}/upload/image`,
} as const;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const SESSION_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;      // 일반 조회
const FETCH_LONG_TIMEOUT_MS = 120_000; // 등록/업로드 등 오래 걸리는 작업

const CATEGORY_MAP: Record<string, string> = {
  '맛집/카페': '0',
  '중장비/자동차': '1',
  '뷰티/미용': '2',
  '꽃집/스튜디오': '3',
  '부동산/학원': '4',
  '인테리어/청소': '5',
  '점집/헬스,운동': '6',
  '기타': '7',
};

export const CATEGORIES = Object.keys(CATEGORY_MAP);

// -- 타입 --

export interface RegisterKeywordParams {
  businessName: string;
  placeId: string;
  keyword: string;
  category: string;
  staffName: string;
  adType: string;
}

export interface RegisterReportParams {
  placeId: string;
  phone1: string;
  phone2?: string;
  contractStart: string;
  months: number;
}

export interface RegisterResult {
  success: boolean;
  message: string;
  duplicate?: boolean;
}

interface KeywordEntry {
  keyword: string;
  firstRank: string;
  rank: string;
  staffName: string;
  date: string;
  adType: string;
}

interface DupDBItem {
  no: string;
  registeredAt: string;
  businessName: string;
  placeId: string;
  category: string;
  manager: string;
  contractStatus: string;
}

export interface SearchResult {
  ok: boolean;
  total: number;
  items: DupDBItem[];
  error?: string;
}

interface HttpResult {
  ok: boolean;
  status: number;
  body: string;
}

interface LoginResult {
  ok: boolean;
  message?: string;
  error?: string;
}

// -- 세션 관리 --

interface SessionState {
  cookies: Record<string, string>;
  loggedIn: boolean;
  lastLogin: number;
}

let session: SessionState = { cookies: {}, loggedIn: false, lastLogin: 0 };

// Operation-level mutex: 모든 외부 API 호출을 직렬화하여 세션 경쟁 방지
let operationQueue: Promise<unknown> = Promise.resolve();

function withOperationLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = operationQueue.then(fn, fn);
  operationQueue = next.catch(() => undefined);
  return next;
}

function getCookieHeader(): string {
  return Object.entries(session.cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function collectCookies(response: Response): void {
  const headers = response.headers.getSetCookie?.() || [];
  for (const header of headers) {
    const cookiePart = header.split(';')[0]?.trim();
    if (!cookiePart) continue;
    const eqIdx = cookiePart.indexOf('=');
    if (eqIdx > 0) {
      session.cookies[cookiePart.substring(0, eqIdx)] = cookiePart.substring(eqIdx + 1);
    }
  }
}

function resetSession(): void {
  session = { cookies: {}, loggedIn: false, lastLogin: 0 };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -- HTTP --

const COMMON_HEADERS = {
  'User-Agent': USER_AGENT,
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
} as const;

async function httpGet(url: string, long = false): Promise<HttpResult> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      Cookie: getCookieHeader(),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(long ? FETCH_LONG_TIMEOUT_MS : FETCH_TIMEOUT_MS),
  });
  collectCookies(res);
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function httpPost(url: string, data: Record<string, string>, long = false): Promise<HttpResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Referer: url,
      Cookie: getCookieHeader(),
    },
    body: new URLSearchParams(data).toString(),
    redirect: 'follow',
    signal: AbortSignal.timeout(long ? FETCH_LONG_TIMEOUT_MS : FETCH_TIMEOUT_MS),
  });
  collectCookies(res);
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function httpAjaxPost(
  url: string,
  data: Record<string, string>,
  referer?: string,
  long = false,
): Promise<HttpResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE_URL,
      Referer: referer || url,
      Cookie: getCookieHeader(),
    },
    body: new URLSearchParams(data).toString(),
    redirect: 'follow',
    signal: AbortSignal.timeout(long ? FETCH_LONG_TIMEOUT_MS : FETCH_TIMEOUT_MS),
  });
  collectCookies(res);
  return { ok: res.ok, status: res.status, body: await res.text() };
}

// -- HTML 파싱 --

function parseTdCells(html: string): string[] {
  const cells: string[] = [];
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = tdRegex.exec(html)) !== null) {
    cells.push(m[1].replace(/<[^>]*>/g, '').trim());
  }
  return cells;
}

// HTML 태그 유지한 원본 td 내용 반환
function parseTdCellsRaw(html: string): string[] {
  const cells: string[] = [];
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = tdRegex.exec(html)) !== null) {
    cells.push(m[1].trim());
  }
  return cells;
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractFailMessage(json: Record<string, unknown>): string {
  const dataObj = json.data && typeof json.data === 'object'
    ? (json.data as Record<string, unknown>)
    : null;
  return dataObj?.msg
    ? String(dataObj.msg)
    : String(json.msg || json.error || json.message || '');
}

function isDuplicateMessage(msg: string): boolean {
  return msg.includes('중복') || msg.includes('이미');
}

// -- 재시도 헬퍼 --

async function withRetry<T>(
  fn: (attempt: number) => Promise<T | null>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fallback: any,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn(attempt);
      if (result !== null) return result;
    } catch (e) {
      if (attempt >= MAX_RETRIES) {
        console.error(`[homejeonsan] retry exhausted: ${e}`);
      }
    }
    if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
  }
  return fallback as T;
}

// -- 인증 --

export async function testConnection(): Promise<LoginResult> {
  return withRetry<LoginResult>(async () => {
    const res = await httpGet(ENDPOINTS.LOGIN);
    if (res.body?.includes('loginId') || res.body?.includes('로그인')) {
      return { ok: true, message: '연결 성공' };
    }
    return null;
  }, { ok: false, error: '연결 실패' });
}

// login()은 operation lock 내부에서만 호출됨 — loginPromise 불필요
export async function login(): Promise<LoginResult> {
  if (session.loggedIn && Date.now() - session.lastLogin < SESSION_TTL_MS) {
    return { ok: true, message: '세션 재사용' };
  }
  return doLogin();
}

async function doLogin(): Promise<LoginResult> {
  // DB에서 최신 계정 정보 동기화
  try {
    const rows = await db.systemSetting.findMany({ where: { key: { in: ['HOMEJEONSAN_ID', 'HOMEJEONSAN_PW', 'HOMEJEONSAN_PW2'] } } });
    for (const r of rows) {
      if (r.value && r.value !== process.env[r.key]) {
        process.env[r.key] = r.value;
        resetSession(); // 계정 변경 감지 시 세션 초기화
      }
    }
  } catch (e) {
    console.error('[homejeonsan] DB 계정 조회 실패:', e);
  }

  return withRetry(async (attempt) => {
    resetSession();

    // 1단계: 세션 쿠키 획득
    const pageRes = await httpGet(ENDPOINTS.LOGIN);
    if (!pageRes.ok && !pageRes.body) return null;

    // 2단계: 1차 로그인
    const loginRes = await httpPost(ENDPOINTS.LOGIN, {
      loginId: process.env.HOMEJEONSAN_ID || '',
      loginPw: process.env.HOMEJEONSAN_PW || '',
    });
    if (!loginRes.body) return null;

    const json = tryParseJson(loginRes.body);

    if (json) {
      if (!json.success) {
        // 인증 실패는 재시도 불필요
        return { ok: false, error: String(json.msg || '아이디 또는 비밀번호가 올바르지 않습니다.') };
      }

      // 3단계: 2차 비밀번호
      const auth2Res = await httpPost(ENDPOINTS.AUTH2, { commonPw: process.env.HOMEJEONSAN_PW2 || '' });
      const auth2Json = tryParseJson(auth2Res.body);

      if (auth2Json && !auth2Json.success) {
        return { ok: false, error: String(auth2Json.msg || '2차 비밀번호가 올바르지 않습니다.') };
      }
      if (!auth2Json && (auth2Res.body.includes('commonPw') || auth2Res.body.includes('비밀번호'))) {
        return { ok: false, error: '2차 비밀번호가 올바르지 않습니다.' };
      }

      session.loggedIn = true;
      session.lastLogin = Date.now();
      return { ok: true, message: '로그인 성공' };
    }

    // HTML 응답 폴백
    if (loginRes.body.includes('loginId') && loginRes.body.includes('로그인')) {
      return null; // 재시도
    }

    // 리다이렉트 후 HTML = 성공으로 간주
    await httpPost(ENDPOINTS.AUTH2, { commonPw: process.env.HOMEJEONSAN_PW2 || '' });

    const checkRes = await httpGet(ENDPOINTS.DUP_LIST);
    if (checkRes.body && !checkRes.body.includes('loginId') && !checkRes.body.includes('commonPw')) {
      session.loggedIn = true;
      session.lastLogin = Date.now();
      return { ok: true, message: '로그인 성공' };
    }

    return null;
  }, { ok: false, error: '로그인 실패' });
}

export async function isLoggedIn(): Promise<boolean> {
  if (Object.keys(session.cookies).length === 0) return false;
  try {
    const res = await httpGet(ENDPOINTS.DUP_LIST);
    if (!res.body) return false;
    return !res.body.includes('loginId') && !res.body.includes('commonPw');
  } catch {
    return false;
  }
}

export function logout(): void {
  resetSession();
}

// -- 키워드 검색/등록/삭제 --

export function searchKeywords(
  placeNumber: string,
  searchType: 'place_number' | 'business_name' = 'place_number',
): Promise<{ success: boolean; keywords: KeywordEntry[]; total: number; error?: string }> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, keywords: [], total: 0, error: 'login failed' };

  try {
    const url = `${ENDPOINTS.KEYWORD_LIST}?page=1&pageSize=200&searchType=${searchType}&searchKeyword=${encodeURIComponent(placeNumber)}`;
    const res = await httpGet(url);
    if (!res.body) return { success: false, keywords: [], total: 0, error: 'no response' };

    const keywords: KeywordEntry[] = [];
    const trParts = res.body.split(/<tr[^>]*>/i);

    const KNOWN_AD_TYPES = new Set(['정상', '선광고', '무료']);
    const KNOWN_CATEGORIES = new Set(['맛집/카페', '중장비/자동차', '뷰티/미용', '꽃집/스튜디오', '부동산/학원', '인테리어/청소', '점집/헬스,운동', '기타']);

    for (const part of trParts) {
      // 상호명 검색 시 placeNumber가 아니라 검색어이므로 필터 완화
      if (searchType === 'place_number' && !part.includes(placeNumber)) continue;
      const cells = parseTdCells(part);
      const placeIdx = cells.indexOf(placeNumber);
      if (cells.length >= 12 && placeIdx >= 0) {
        // placeIdx 기준 고정 위치: keyword, rank 등
        const keyword = cells[placeIdx - 5] || '';
        const firstRank = cells[placeIdx - 4] || '';
        const rank = cells[placeIdx - 3] || '';
        const date = cells[placeIdx - 7] || '';

        // 담당자/adType은 위치가 유동적 → 값 기반 판별
        let staffName = '';
        let adType = '정상';
        // placeIdx 이후 셀들에서 찾기
        for (let i = placeIdx + 1; i < cells.length; i++) {
          const v = cells[i].trim();
          if (KNOWN_AD_TYPES.has(v)) { adType = v; }
          else if (!KNOWN_CATEGORIES.has(v) && !['순위조회', '보기', '메모', '삭제', ''].includes(v) && !/^\d+$/.test(v) && !/^\d{4}-/.test(v)) {
            if (!staffName) staffName = v; // 첫 번째 비-시스템 값이 담당자
          }
        }

        keywords.push({ keyword, firstRank, rank, staffName, date, adType });
      }
    }

    return { success: true, keywords, total: keywords.length };
  } catch (e) {
    return { success: false, keywords: [], total: 0, error: String(e) };
  }
  });
}

export function registerKeyword(params: RegisterKeywordParams): Promise<RegisterResult> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: `로그인 실패: ${loginResult.error || ''}` };

  // /admin/place/excel 엔드포인트 사용 (담당자 정상 반영)
  const categoryCode = CATEGORY_MAP[params.category] ?? CATEGORY_MAP['기타'] ?? '7';
  const excelData = [{
    placeName: params.businessName,
    keyword: params.keyword,
    placeNumber: params.placeId,
    category: params.category || '기타',
    salesMemberName: params.staffName,
    advertisementType: params.adType || '정상',
  }];
  const postBody = `params={data:${encodeURIComponent(JSON.stringify(excelData))}}`;

  return withRetry(async () => {
    const res = await fetch(`${BASE_URL}/admin/place/excel`, {
      method: 'POST',
      headers: {
        ...({ 'User-Agent': USER_AGENT }),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: BASE_URL,
        Referer: ENDPOINTS.KEYWORD_LIST,
        Cookie: getCookieHeader(),
      },
      body: postBody,
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_LONG_TIMEOUT_MS),
    });
    collectCookies(res);
    const resObj = { ok: res.ok, status: res.status, body: await res.text() };
    if (!resObj.body) return null;

    const json = tryParseJson(resObj.body);
    if (json) {
      // /excel 엔드포인트: msg에 "N건 성공"이 포함되면 성공
      const msg = String(json.msg || '');
      // msgList에서 상세 실패 사유 추출
      const jsonData = json.data as Record<string, unknown> | undefined;
      const msgList = Array.isArray(jsonData?.msgList) ? jsonData.msgList as string[] : [];
      const detailReason = msgList.length > 0 ? ` (${msgList.join(', ')})` : '';
      if (msg.includes('성공') && !msg.startsWith('0건 성공')) {
        return { success: true, message: msg } as RegisterResult;
      }
      if (json.success || json.result === 'success') {
        return { success: true, message: '키워드 등록 완료' };
      }
      const failMsg = (msg || extractFailMessage(json) || '등록 실패') + detailReason;
      return { success: false, message: failMsg, duplicate: isDuplicateMessage(failMsg) };
    }

    if (resObj.status === 200 || resObj.status === 302) {
      return { success: true, message: '키워드 등록 완료' };
    }
    // 403: 세션 만료 → 리셋 후 재시도
    if (resObj.status === 403) {
      resetSession();
      const relogin = await login();
      if (relogin.ok) return null; // withRetry가 재시도
    }
    return { success: false, message: `등록 실패: HTTP ${resObj.status}` };
  }, { success: false, message: '등록 실패 (최대 재시도 초과)' });
  });
}

export function deleteKeyword(rowId: string): Promise<{ success: boolean; message: string }> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: 'login failed' };

  try {
    const res = await fetch(ENDPOINTS.KEYWORD_DELETE, {
      method: 'PATCH',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: getCookieHeader(),
      },
      body: JSON.stringify({ placeId: rowId, delYn: 'X' }),
    });
    collectCookies(res);
    const json = tryParseJson(await res.text());
    if (json?.success) return { success: true, message: '삭제 완료' };
    return { success: false, message: json?.msg ? String(json.msg) : '삭제 실패' };
  } catch (e) {
    return { success: false, message: String(e) };
  }
  });
}

export function findRowIds(placeNumber: string, keyword?: string): Promise<string[]> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return [];

  try {
    const url = `${ENDPOINTS.KEYWORD_LIST}?page=1&pageSize=200&searchType=place_number&searchKeyword=${encodeURIComponent(placeNumber)}`;
    const res = await httpGet(url);
    if (!res.body) return [];

    const ids: string[] = [];
    const chunks = res.body.split(/<tr/gi);

    for (const chunk of chunks) {
      if (!chunk.includes(placeNumber)) continue;
      const idMatch = chunk.match(/data-id="(\d+)"/);
      if (!idMatch) continue;

      if (keyword) {
        // 정확한 키워드 매칭 (substring 매칭 방지 — "핸드폰"으로 "핸드폰수리"가 삭제되지 않도록)
        const exactPattern = new RegExp(`>${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\\/`, 'i');
        const encodedKw = encodeURIComponent(keyword);
        const exactUrlPattern = new RegExp(`/search/${encodedKw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[&"'<\\s]|$)`, 'i');
        if (exactPattern.test(chunk) || exactUrlPattern.test(chunk)) {
          ids.push(idMatch[1]);
        }
      } else {
        ids.push(idMatch[1]);
      }
    }
    return ids;
  } catch {
    return [];
  }
  });
}

// -- 리포트 --

export function checkReport(
  placeNumber: string,
): Promise<{ exists: boolean; contractPeriod?: string; reportUrl?: string; error?: string }> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { exists: false, error: 'login failed' };

  try {
    const url = `${ENDPOINTS.REPORT}?selectedMenu=2&searchType=placeId&searchKeyword=${encodeURIComponent(placeNumber)}`;
    const res = await httpGet(url);
    if (!res.body) return { exists: false };

    const trParts = res.body.split(/<tr[^>]*>/i);

    for (const part of trParts) {
      const cells = parseTdCells(part);
      const placeIdx = cells.indexOf(placeNumber);
      if (cells.length >= 7 && placeIdx >= 0) {
        const contractPeriod = placeIdx === 0 ? (cells[6] || '') : (cells[placeIdx + 6] || '');
        const reportUrl = placeIdx === 0 ? (cells[3] || '') : (cells[placeIdx + 3] || '');
        return { exists: true, contractPeriod, reportUrl };
      }
    }
    return { exists: false };
  } catch (e) {
    return { exists: false, error: String(e) };
  }
  });
}

// 리포트 상세 정보 (블로그/인스타 건수 + 최종발행일 + 링크 목록)
export interface PostLink {
  type: 'blog' | 'insta';
  url: string;
  date: string | null;
}

export interface ReportStats {
  exists: boolean;
  placeName: string | null;
  reportUrl: string | null;
  contractPeriod: string | null;
  blogCount: number;
  instaCount: number;
  lastBlogDate: string | null;
  lastInstaDate: string | null;
  posts: PostLink[];
  allCells: string[];
  error?: string;
}

export function fetchReportStats(placeNumber: string): Promise<ReportStats> {
  return withOperationLock(async () => {
  const empty: ReportStats = {
    exists: false, placeName: null, reportUrl: null, contractPeriod: null,
    blogCount: 0, instaCount: 0, lastBlogDate: null, lastInstaDate: null,
    posts: [], allCells: [],
  };

  const loginResult = await login();
  if (!loginResult.ok) {
    console.log('[fetchReportStats] login failed:', loginResult.error, 'ID:', process.env.HOMEJEONSAN_ID ? 'set' : 'empty');
    return { ...empty, error: `login failed: ${loginResult.error || 'unknown'}` };
  }

  try {
    // 1. 리포트 목록에서 해당 업체 행 찾기 → reportId + bridge URL 추출
    const listUrl = `${ENDPOINTS.REPORT}?selectedMenu=2&searchType=placeId&searchKeyword=${encodeURIComponent(placeNumber)}`;
    const listRes = await httpGet(listUrl);
    if (!listRes.body) return { ...empty, error: 'report list fetch failed' };

    const trParts = listRes.body.split(/<tr[^>]*>/i);
    let reportId: string | null = null;
    let reportUrl: string | null = null;
    let contractPeriod: string | null = null;
    let allCells: string[] = [];

    let placeName: string | null = null;

    for (const part of trParts) {
      const cells = parseTdCells(part);
      // placeNumber가 cells[0] 또는 cells[1]에 있을 수 있음 (테이블 구조 변경 대응)
      const placeIdx = cells.indexOf(placeNumber);
      if (cells.length >= 7 && placeIdx >= 0) {
        allCells = cells;
        // placeIdx 기준으로 상대 오프셋 계산
        if (placeIdx === 0) {
          // 기존 구조: [placeNumber, placeName, score, reportURL, ..., contractPeriod]
          placeName = cells[1] || null;
          reportUrl = cells[3] || null;
          contractPeriod = cells[6] || null;
        } else {
          // 새 구조: [reportNo, placeNumber, placeName, score, reportURL, ..., contractPeriod]
          placeName = cells[placeIdx + 1] || null;
          reportUrl = cells[placeIdx + 3] || null;
          contractPeriod = cells[placeIdx + 6] || null;
        }

        // "보기" 버튼 onclick에서 reportId 추출 (td 속성에 있음)
        const ridMatch = part.match(/reportId=(\d+)/);
        if (ridMatch) reportId = ridMatch[1];
        // reportId가 cells[0]에 있을 수도 있음
        if (!reportId && placeIdx > 0 && /^\d+$/.test(cells[0])) reportId = cells[0];
        break;
      }
    }

    if (!reportId) {
      // 디버그: 응답에 로그인 페이지가 돌아왔는지, tr이 몇 개인지 확인
      const hasLoginForm = listRes.body.includes('loginId') || listRes.body.includes('로그인');
      const trCount = trParts.length;
      const firstCells = trParts.slice(1, 3).map(p => parseTdCells(p).join('|'));
      console.log(`[fetchReportStats] reportId not found. trCount=${trCount}, hasLoginForm=${hasLoginForm}, placeNumber=${placeNumber}, firstRows=`, firstCells);
      return { ...empty, allCells };
    }

    // 2. /admin/post 페이지에서 블로그/인스타 게시물 파싱
    //    페이지네이션 순회: page=1부터 시작, 새로운 게시물이 없을 때까지 반복
    let allPostHtml = '';
    const PAGE_SIZE = 500;
    const MAX_PAGES = 10; // 안전장치: 최대 5000건
    for (let pg = 1; pg <= MAX_PAGES; pg++) {
      const postUrl = `${BASE_URL}/admin/post?reportId=${reportId}&placeNumber=${encodeURIComponent(placeNumber)}&page=${pg}&pageSize=${PAGE_SIZE}`;
      const postRes = await httpGet(postUrl);
      if (!postRes.ok || !postRes.body) break;

      const tbody = postRes.body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      if (!tbody) break;

      const rowCount = (tbody[1].match(/<tr[^>]*>/gi) || []).length;
      allPostHtml += tbody[1];

      // 이 페이지가 PAGE_SIZE보다 적으면 마지막 페이지
      if (rowCount < PAGE_SIZE) break;
    }

    if (!allPostHtml) {
      return { exists: true, placeName, reportUrl, contractPeriod, blogCount: 0, instaCount: 0, lastBlogDate: null, lastInstaDate: null, posts: [], allCells, error: 'post page empty' };
    }

    // 게시물 파싱: 행 단위로 분리하여 실제 게시물 URL만 추출
    let blogCount = 0, instaCount = 0;
    let lastBlogDate: string | null = null, lastInstaDate: string | null = null;
    const posts: PostLink[] = [];

    // 이미지/프록시/썸네일 URL은 게시물이 아니므로 제외
    function isActualPostUrl(url: string): boolean {
      if (!url || url.startsWith('/')) return false; // 상대경로 (image-proxy 등)
      if (url.includes('pstatic.net') || url.includes('blogthumb') || url.includes('blogimgs')) return false;
      if (url.includes('image-proxy') || url.includes('/upload/') || url.includes('/static/')) return false;
      return url.startsWith('http');
    }

    function classifyPostUrl(url: string): 'blog' | 'insta' | null {
      if (url.includes('instagram.com')) return 'insta';
      if (url.includes('blog.naver.com')) return 'blog';
      // naver 포스트 등도 블로그로 분류
      if (url.includes('post.naver.com') || url.includes('m.blog.naver.com')) return 'blog';
      return null;
    }

    // 행 단위 파싱 (전 페이지 합산 HTML)
    {
      const rowMatches = allPostHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      for (const rm of rowMatches) {
        const rowHtml = rm[1];
        const dateMatch = rowHtml.match(/(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/);
        const postDate = dateMatch ? dateMatch[1] : null;

        // 행 내 모든 <a href> 중 실제 게시물 URL 찾기
        const allHrefs = rowHtml.matchAll(/<a\s+href="([^"]+)"/gi);
        let found = false;
        for (const hm of allHrefs) {
          const url = hm[1];
          if (!isActualPostUrl(url)) continue;
          const pType = classifyPostUrl(url);
          if (!pType) continue;

          if (pType === 'insta') {
            instaCount++;
            posts.push({ type: 'insta', url, date: postDate });
            if (postDate && (!lastInstaDate || postDate > lastInstaDate)) lastInstaDate = postDate;
          } else {
            blogCount++;
            posts.push({ type: 'blog', url, date: postDate });
            if (postDate && (!lastBlogDate || postDate > lastBlogDate)) lastBlogDate = postDate;
          }
          found = true;
          break; // 행당 하나의 게시물
        }

        // href에 실제 URL 없으면, 링크 텍스트에서 URL 추출 시도
        if (!found) {
          const textUrls = rowHtml.matchAll(/https?:\/\/(?:blog\.naver\.com|www\.instagram\.com|m\.blog\.naver\.com)[^\s<"']+/gi);
          for (const tu of textUrls) {
            const url = tu[0];
            const pType = classifyPostUrl(url);
            if (!pType) continue;
            if (pType === 'insta') {
              instaCount++;
              posts.push({ type: 'insta', url, date: postDate });
              if (postDate && (!lastInstaDate || postDate > lastInstaDate)) lastInstaDate = postDate;
            } else {
              blogCount++;
              posts.push({ type: 'blog', url, date: postDate });
              if (postDate && (!lastBlogDate || postDate > lastBlogDate)) lastBlogDate = postDate;
            }
            break;
          }
        }
      }
    }

    return {
      exists: true, placeName, reportUrl, contractPeriod,
      blogCount, instaCount, lastBlogDate, lastInstaDate,
      posts, allCells,
    };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
  });
}

export function registerReport(params: RegisterReportParams): Promise<RegisterResult> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: `로그인 실패: ${loginResult.error || ''}` };

  const digits1 = params.phone1.replace(/[^0-9]/g, '');
  const endDate = new Date(params.contractStart);
  endDate.setMonth(endDate.getMonth() + params.months);

  const postData: Record<string, string> = {
    placeNumber: params.placeId,
    mobileTel1: digits1.slice(0, 3) || '010',
    mobileTel2: digits1.slice(3, 7),
    mobileTel3: digits1.slice(7, 11),
    startDate: params.contractStart,
    endDate: endDate.toISOString().split('T')[0],
    // 모집플레이스.com saveForm에 존재하는 필수 hidden 필드
    reportId: '',
    alimPostCnt: '0',
    homepageUrl: '',
    promotionUrl: '',
    befLeftFileUrl: '',
    befRightFileUrl: '',
    aftLeftFileUrl: '',
    aftRightFileUrl: '',
  };

  if (params.phone2) {
    const digits2 = params.phone2.replace(/[^0-9]/g, '');
    postData.mobileTel4 = digits2.slice(0, 3) || '010';
    postData.mobileTel5 = digits2.slice(3, 7);
    postData.mobileTel6 = digits2.slice(7, 11);
  }

  return withRetry(async () => {
    console.log('[registerReport] placeNumber:', postData.placeNumber);
    const res = await httpAjaxPost(ENDPOINTS.REPORT, postData, ENDPOINTS.REPORT + '/add', true);
    if (!res.body) return null;

    const json = tryParseJson(res.body);
    if (json) {
      if (json.success || json.result === 'success') {
        return { success: true, message: '리포트 등록 완료' };
      }
      const failMsg = extractFailMessage(json) || '리포트 등록 실패';
      return { success: false, message: failMsg, duplicate: isDuplicateMessage(failMsg) };
    }

    if (res.status === 200 || res.status === 302) {
      return { success: true, message: '리포트 등록 완료' };
    }
    // 403: 세션 만료 → 리셋 후 재시도
    if (res.status === 403) {
      resetSession();
      const relogin = await login();
      if (relogin.ok) return null; // withRetry가 재시도
    }
    return { success: false, message: `리포트 등록 실패: HTTP ${res.status}` };
  }, { success: false, message: '리포트 등록 실패 (최대 재시도 초과)' });
  });
}

// -- 중복DB --

async function _searchDupDB(keyword: string): Promise<SearchResult> {
  const loginResult = await login();
  if (!loginResult.ok) return { ok: false, total: 0, items: [], error: `로그인 실패: ${loginResult.error || ''}` };

  try {
    const res = await httpGet(`${ENDPOINTS.DUP_LIST}?searchKeyword=${encodeURIComponent(keyword)}`);
    if (!res.body) return { ok: false, total: 0, items: [], error: '검색 요청 실패' };

    const items: DupDBItem[] = [];
    const tbodyMatch = res.body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (tbodyMatch) {
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
        const cells = parseTdCells(rowMatch[1]);
        if (cells.length >= 4) {
          items.push({
            no: cells[0] || '',
            registeredAt: cells[1] || '',
            businessName: cells[2] || '',
            placeId: cells[3] || '',
            category: cells[4] || '',
            manager: cells[5] || '',
            contractStatus: cells[6] || '',
          });
        }
      }
    }

    return { ok: true, total: items.length, items };
  } catch (e) {
    return { ok: false, total: 0, items: [], error: `검색 오류: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function searchDupDB(keyword: string): Promise<SearchResult> {
  return withOperationLock(() => _searchDupDB(keyword));
}

export interface RegisterDupParams {
  businessName: string;
  placeId: string;
  category: string;
}

export function registerDup(params: RegisterDupParams): Promise<RegisterResult> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: `로그인 실패: ${loginResult.error || ''}` };

  // 기존 등록 여부 확인 (_searchDupDB: 데드락 방지)
  const existing = await _searchDupDB(params.placeId);
  if (existing.ok && existing.items.some((item) => item.placeId === params.placeId)) {
    return { success: false, message: '이미 등록된 플레이스 번호입니다.', duplicate: true };
  }

  const postData: Record<string, string> = {
    placeName: params.businessName,
    placeNumber: params.placeId,
    category: params.category || '기타',
  };

  return withRetry(async () => {
    const res = await httpAjaxPost(ENDPOINTS.DUP_LIST, postData, ENDPOINTS.DUP_LIST);
    if (!res.body) return null;

    const json = tryParseJson(res.body);
    if (json) {
      if (json.success || json.result === 'success') {
        return { success: true, message: '중복DB 등록 완료' };
      }
      const failMsg = extractFailMessage(json) || '등록 실패';
      return { success: false, message: failMsg, duplicate: isDuplicateMessage(failMsg) };
    }

    return { success: false, message: '등록 요청이 처리되지 않았습니다 (비정상 응답)' };
  }, { success: false, message: '등록 실패 (최대 재시도 초과)' });
  });
}

// ===================================================================
// 게시물 등록 (인스타/블로그)
// ===================================================================

export interface RegisterPostParams {
  placeNumber: string;
  type: '1' | '2'; // 1=블로그 체험단, 2=인스타
  title: string;
  link: string;
  postDate?: string;
  contents?: string;
}

/**
 * reportId를 placeNumber로 조회
 */
async function getReportId(
  placeNumber: string,
): Promise<{ reportId: string | null; error?: string }> {
  const loginResult = await login();
  if (!loginResult.ok) return { reportId: null, error: '로그인 실패' };

  // 검색 결과가 일시적으로 누락될 수 있으므로 최대 3회 재시도
  const MAX_ATTEMPTS = 3;
  let lastError = '리포트가 존재하지 않습니다';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const url = `${ENDPOINTS.REPORT}?selectedMenu=2&searchType=placeId&searchKeyword=${encodeURIComponent(placeNumber)}`;
      const res = await httpGet(url);
      if (!res.body) {
        lastError = '응답 없음';
        if (attempt < MAX_ATTEMPTS) await sleep(800);
        continue;
      }

      const trParts = res.body.split(/<tr[^>]*>/i);
      for (const part of trParts) {
        const cells = parseTdCells(part);
        const placeIdx = cells.indexOf(placeNumber);
        if (cells.length >= 7 && placeIdx >= 0) {
          const ridMatch = part.match(/reportId=(\d+)/);
          if (ridMatch) return { reportId: ridMatch[1] };
          if (placeIdx > 0 && /^\d+$/.test(cells[0])) return { reportId: cells[0] };
        }
      }
      if (attempt < MAX_ATTEMPTS) await sleep(800);
    } catch (e) {
      lastError = String(e);
      if (attempt < MAX_ATTEMPTS) await sleep(800);
    }
  }
  return { reportId: null, error: lastError };
}

/**
 * 게시물 등록 (인스타 type=2 / 블로그 type=1)
 * POST /admin/post — fileUrl 없이 링크만 전송 시도
 */
export function registerPost(params: RegisterPostParams): Promise<RegisterResult> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: `로그인 실패: ${loginResult.error || ''}` };

  // reportId 조회
  const { reportId, error: ridError } = await getReportId(params.placeNumber);
  if (!reportId) return { success: false, message: ridError || '리포트를 찾을 수 없습니다' };

  const postData: Record<string, string> = {
    reportId,
    placeNumber: params.placeNumber,
    type: params.type,
    title: params.title || params.link,
    link: params.link,
    postDate: params.postDate || new Date().toISOString().split('T')[0],
    contents: params.contents || '',
    fileUrl: '',
  };

  // POST는 비멱등이므로 retry 금지 — 애매한 응답은 서버 실제 상태 검증으로 판정
  const referer = `${ENDPOINTS.POST_ADD}?reportId=${reportId}&placeNumber=${params.placeNumber}`;
  const attemptPost = async (): Promise<{ res: Awaited<ReturnType<typeof httpAjaxPost>>; json: Record<string, unknown> | null }> => {
    const res = await httpAjaxPost(ENDPOINTS.POST, postData, referer, true);
    const json = res.body ? tryParseJson(res.body) : null;
    return { res, json };
  };

  let { res, json } = await attemptPost();

  // 403이면 세션 만료 — 재로그인 후 1회만 재시도 (이때는 서버에 POST가 안 갔음)
  if (res.status === 403) {
    resetSession();
    const relogin = await login();
    if (relogin.ok) {
      ({ res, json } = await attemptPost());
    }
  }

  // JSON 응답: success/fail 명확히 판정
  if (json) {
    if (json.success || json.result === 'success') {
      return { success: true, message: json.msg ? String(json.msg) : '게시물 등록 완료' };
    }
    const failMsg = extractFailMessage(json) || '등록 실패';
    // 명확한 fail JSON이라도, 실제 서버에 등록됐을 가능성 검증
    const verified = await verifyPostRegistered(reportId, params.placeNumber, params.link);
    if (verified) return { success: true, message: '등록 확인됨 (응답 오류이나 서버 반영됨)' };
    return { success: false, message: failMsg };
  }

  // 응답 body 없거나 JSON 파싱 실패 — 서버 상태 검증으로 판정
  const verified = await verifyPostRegistered(reportId, params.placeNumber, params.link);
  if (verified) return { success: true, message: '등록 확인됨' };

  // 2xx/3xx면 성공으로 간주 (검증도 못 찾았지만 오류 아님)
  if (res.status === 200 || res.status === 302) {
    return { success: true, message: '게시물 등록 완료 (검증 불가)' };
  }
  return { success: false, message: `등록 실패: HTTP ${res.status}` };
  });
}

/**
 * 게시물이 실제로 등록됐는지 모집플레이스 /admin/post 페이지에서 직접 확인
 * — registerPost의 withOperationLock 컨텍스트 안에서 호출되므로 락 획득 금지
 */
async function verifyPostRegistered(reportId: string, placeNumber: string, link: string): Promise<boolean> {
  try {
    await sleep(800); // 서버 반영 시간 확보
    const target = normalizePostUrl(link);
    // 첫 페이지만 확인 (방금 등록된 게시물은 최상단에 있음)
    const postUrl = `${BASE_URL}/admin/post?reportId=${reportId}&placeNumber=${encodeURIComponent(placeNumber)}&page=1&pageSize=50`;
    const postRes = await httpGet(postUrl);
    if (!postRes.body) return false;
    const tbody = postRes.body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbody) return false;
    // tbody 전체에서 링크 검색
    const hrefs = Array.from(tbody[1].matchAll(/<a\s+href="([^"]+)"/gi)).map(m => m[1]);
    const textUrls = Array.from(tbody[1].matchAll(/https?:\/\/(?:blog\.naver\.com|www\.instagram\.com|m\.blog\.naver\.com)[^\s<"']+/gi)).map(m => m[0]);
    const all = [...hrefs, ...textUrls];
    return all.some(u => normalizePostUrl(u) === target);
  } catch {
    return false;
  }
}

function normalizePostUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// ===================================================================
// 리포트 필드 조회/수정 (홈페이지, 영상, SEO)
// ===================================================================

export interface ReportFormData {
  reportId: string;
  placeNumber: string;
  mobileTel1: string;
  mobileTel2: string;
  mobileTel3: string;
  mobileTel4: string;
  mobileTel5: string;
  mobileTel6: string;
  startDate: string;
  endDate: string;
  homepageUrl: string;
  promotionUrl: string;
  befLeftFileUrl: string;
  befRightFileUrl: string;
  aftLeftFileUrl: string;
  aftRightFileUrl: string;
  alimPostCnt: string;
}

/**
 * 리포트 수정 폼의 기존 데이터를 GET으로 조회하여 파싱 (내부용 — lock 없음)
 */
async function _getReportFormData(
  placeNumber: string,
): Promise<{ data: ReportFormData | null; error?: string }> {
  const loginResult = await login();
  if (!loginResult.ok) return { data: null, error: '로그인 실패' };

  // reportId 조회
  const { reportId, error: ridError } = await getReportId(placeNumber);
  if (!reportId) return { data: null, error: ridError || '리포트를 찾을 수 없습니다' };

  try {
    const url = `${ENDPOINTS.REPORT_ADD}?reportId=${reportId}&placeNumber=${encodeURIComponent(placeNumber)}`;
    const res = await httpGet(url);
    if (!res.body) return { data: null, error: '응답 없음' };

    // saveForm 내부의 input value 파싱
    const formMatch = res.body.match(/<form[^>]*id="saveForm"[^>]*>([\s\S]*?)<\/form>/i);
    if (!formMatch) return { data: null, error: '리포트 폼을 찾을 수 없습니다' };

    const formHtml = formMatch[1];

    function extractValue(name: string): string {
      // input value
      const inputMatch = formHtml.match(
        new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'),
      );
      if (inputMatch) return inputMatch[1];
      // reverse: value before name
      const reverseMatch = formHtml.match(
        new RegExp(`value="([^"]*)"[^>]*name="${name}"`, 'i'),
      );
      if (reverseMatch) return reverseMatch[1];
      return '';
    }

    const data: ReportFormData = {
      reportId,
      placeNumber: extractValue('placeNumber') || placeNumber,
      mobileTel1: extractValue('mobileTel1'),
      mobileTel2: extractValue('mobileTel2'),
      mobileTel3: extractValue('mobileTel3'),
      mobileTel4: extractValue('mobileTel4'),
      mobileTel5: extractValue('mobileTel5'),
      mobileTel6: extractValue('mobileTel6'),
      startDate: extractValue('startDate'),
      endDate: extractValue('endDate'),
      homepageUrl: extractValue('homepageUrl'),
      promotionUrl: extractValue('promotionUrl'),
      befLeftFileUrl: extractValue('befLeftFileUrl'),
      befRightFileUrl: extractValue('befRightFileUrl'),
      aftLeftFileUrl: extractValue('aftLeftFileUrl'),
      aftRightFileUrl: extractValue('aftRightFileUrl'),
      alimPostCnt: extractValue('alimPostCnt') || '0',
    };

    return { data };
  } catch (e) {
    return { data: null, error: String(e) };
  }
}

export function getReportFormData(
  placeNumber: string,
): Promise<{ data: ReportFormData | null; error?: string }> {
  return withOperationLock(() => _getReportFormData(placeNumber));
}

/**
 * 리포트 필드 수정 — 기존 데이터를 조회 후 변경할 필드만 덮어씌워서 POST
 */
export function updateReportFields(
  placeNumber: string,
  fields: Partial<ReportFormData>,
): Promise<RegisterResult> {
  return withOperationLock(async () => {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: `로그인 실패: ${loginResult.error || ''}` };

  // 기존 데이터 조회
  const { data: existing, error: getError } = await _getReportFormData(placeNumber);
  if (!existing) return { success: false, message: getError || '기존 리포트 데이터 조회 실패' };

  // 변경할 필드 병합
  const merged: Record<string, string> = { ...existing, ...fields };

  return withRetry(async () => {
    const referer = `${ENDPOINTS.REPORT_ADD}?reportId=${existing.reportId}&placeNumber=${encodeURIComponent(placeNumber)}`;
    const res = await httpAjaxPost(ENDPOINTS.REPORT, merged, referer, true);
    if (!res.body) return null;

    const json = tryParseJson(res.body);
    if (json) {
      if (json.success || json.result === 'success') {
        return { success: true, message: json.msg ? String(json.msg) : '리포트 수정 완료' };
      }
      const failMsg = extractFailMessage(json) || '수정 실패';
      return { success: false, message: failMsg };
    }

    if (res.status === 200 || res.status === 302) {
      return { success: true, message: '리포트 수정 완료' };
    }
    if (res.status === 403) {
      resetSession();
      const relogin = await login();
      if (relogin.ok) return null;
    }
    return { success: false, message: `수정 실패: HTTP ${res.status}` };
  }, { success: false, message: '수정 실패 (최대 재시도 초과)' });
  });
}

// ===================================================================
// 이미지 업로드 (SEO 비포/애프터)
// ===================================================================

/**
 * 모집플레이스 이미지 업로드 서버로 파일 전송
 * POST /upload/image (multipart/form-data)
 * @returns CloudFront URL
 */
export function uploadImage(
  fileBuffer: Buffer,
  originalName: string,
  fileType: string,
): Promise<{ success: boolean; fileUrl?: string; error?: string }> {
  return withOperationLock(async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const loginResult = await login();
    if (!loginResult.ok) return { success: false, error: '로그인 실패' };

    try {
      const blob = new Blob([new Uint8Array(fileBuffer)]);
      const formData = new FormData();
      formData.append('file', blob, originalName);
      formData.append('fileType', fileType);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(ENDPOINTS.UPLOAD_IMAGE, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          Cookie: getCookieHeader(),
        },
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      collectCookies(res);

      // 세션 만료 시 재로그인 후 재시도
      if (res.status === 403 || res.status === 401) {
        session.loggedIn = false;
        if (attempt === 0) { await new Promise(r => setTimeout(r, 500)); continue; }
      }

      const body = await res.text();
      const json = tryParseJson(body);

      if (json && json.success) {
        const data = json.data as Record<string, unknown> | undefined;
        const fileUrl = data?.fileUrl ? String(data.fileUrl) : '';
        if (fileUrl) return { success: true, fileUrl };
        return { success: false, error: '업로드 응답에 fileUrl 없음' };
      }

      console.error(`[uploadImage] HTTP ${res.status}, body:`, body.substring(0, 500));
      const errMsg = json?.msg ? String(json.msg) : `업로드 실패: HTTP ${res.status}`;
      // 일시적 오류 시 재시도
      if (attempt === 0 && (res.status >= 500 || errMsg.includes('오류'))) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      return { success: false, error: errMsg };
    } catch (e) {
      if (attempt === 0) { await new Promise(r => setTimeout(r, 1000)); continue; }
      return { success: false, error: String(e) };
    }
  }
  return { success: false, error: '재시도 실패' };
  });
}

/** 디버그: 모집플레이스 키워드 등록 폼 필드 확인 */
export async function debugKeywordFormFields(): Promise<{ fields: string[]; html: string }> {
  const loginResult = await login();
  if (!loginResult.ok) return { fields: [], html: 'login failed' };
  const res = await httpGet(ENDPOINTS.KEYWORD_LIST);
  if (!res.body) return { fields: [], html: 'no body' };
  // input/select name 추출
  const fields: string[] = [];
  const nameRegex = /name=["']([^"']+)["']/gi;
  let m;
  while ((m = nameRegex.exec(res.body)) !== null) {
    if (!fields.includes(m[1])) fields.push(m[1]);
  }
  // 폼 영역만 추출
  const formMatch = res.body.match(/<form[\s\S]*?<\/form>/i);
  return { fields, html: formMatch ? formMatch[0].substring(0, 3000) : res.body.substring(0, 3000) };
}

// ===================================================================
// 중복 게시물 스캔 / 삭제 (insta+blog)
// ===================================================================

interface PostRow {
  rowId: string;     // 삭제 API에 넣을 post 고유 ID
  typeCode: string;  // 모집플레이스 data-type: 1=블로그체험단, 2=인스타, 3=블로그기자단
  url: string;       // 게시물 URL (인스타/블로그)
  type: 'blog' | 'insta';
  date: string | null;
  rawHtml: string;   // 디버깅용
}

/**
 * /admin/post 페이지에서 delete 관련 HTML 패턴을 수집 (reconnaissance).
 * 결과로 rowId 추출 패턴, 삭제 버튼 onclick, form action 등을 반환하여
 * deletePostsByIds 구현에 필요한 정보를 수집한다.
 */
export function reconPostDeleteEndpoint(placeNumber: string): Promise<{
  reportId: string | null;
  sampleRowHtml: string[];
  deletePatterns: string[];
  scripts: string[];
  externalScripts: string[];
  externalScriptBodies: Array<{ src: string; body: string }>;
}> {
  return withOperationLock(async () => {
    const loginResult = await login();
    if (!loginResult.ok) return { reportId: null, sampleRowHtml: [], deletePatterns: [], scripts: [], externalScripts: [], externalScriptBodies: [] };

    const { reportId } = await getReportId(placeNumber);
    if (!reportId) return { reportId: null, sampleRowHtml: [], deletePatterns: [], scripts: [], externalScripts: [], externalScriptBodies: [] };

    const postUrl = `${BASE_URL}/admin/post?reportId=${reportId}&placeNumber=${encodeURIComponent(placeNumber)}&page=1&pageSize=50`;
    const res = await httpGet(postUrl);
    if (!res.body) return { reportId, sampleRowHtml: [], deletePatterns: [], scripts: [], externalScripts: [], externalScriptBodies: [] };

    const sampleRows: string[] = [];
    const tbody = res.body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (tbody) {
      const rows = Array.from(tbody[1].matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi));
      for (const r of rows.slice(0, 3)) sampleRows.push(r[0].substring(0, 2000));
    }

    const deletePatterns: string[] = [];
    const patterns = [
      /delete[^"'<>]{0,80}/gi,
      /del[YN]?n[^"'<>]{0,60}/gi,
      /postId=[^&"'<>\s]+/gi,
      /onclick="[^"]*(?:delete|remove|del)[^"]*"/gi,
      /action="[^"]*post[^"]*"/gi,
    ];
    for (const p of patterns) {
      const matches = Array.from(res.body.matchAll(p)).slice(0, 8);
      for (const m of matches) deletePatterns.push(m[0].substring(0, 200));
    }

    const scripts: string[] = [];
    const externalScripts: string[] = [];
    const externalScriptBodies: Array<{ src: string; body: string }> = [];
    const scriptMatches = Array.from(res.body.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi));
    for (const sm of scriptMatches) {
      const attrs = sm[1];
      const body = sm[2];
      const srcMatch = attrs.match(/src=["']([^"']+)["']/);
      if (srcMatch) {
        externalScripts.push(srcMatch[1]);
      } else {
        scripts.push(body.substring(0, 3000));
      }
    }

    // 자체 호스팅 외부 JS 전부 fetch → deleteBtn 핸들러 포함된 파일 탐색
    const markers = /deleteBtn|\/admin\/post\/delete|delYn|post\/delete|\.post\/del|\$\.ajax[\s\S]{0,200}post[\s\S]{0,200}delete/i;
    for (const src of externalScripts) {
      if (src.startsWith('http') && !src.includes(BASE_URL.replace(/https?:\/\//, ''))) continue;
      try {
        const url = src.startsWith('http') ? src : `${BASE_URL}${src.startsWith('/') ? '' : '/'}${src}`;
        const jsRes = await httpGet(url);
        if (!jsRes.body) continue;
        const m = jsRes.body.match(markers);
        if (m) {
          const idx = jsRes.body.indexOf(m[0]);
          externalScriptBodies.push({ src, body: jsRes.body.substring(Math.max(0, idx - 400), idx + 1500) });
        }
      } catch { /* ignore */ }
    }

    // 전체 HTML 응답에서 <script> 제외한 onclick/ajax 관련 단서도 추가 수집
    const bodyAttrs = Array.from(res.body.matchAll(/(?:onclick|data-action|data-url|data-endpoint)=["']([^"']+)["']/gi)).slice(0, 20).map(m => m[0]);
    for (const a of bodyAttrs) deletePatterns.push(a);

    return { reportId, sampleRowHtml: sampleRows, deletePatterns, scripts, externalScripts, externalScriptBodies };
  });
}

/**
 * /admin/post 페이지에서 모든 게시물을 파싱하여 중복 URL 그룹을 반환.
 */
export function scanDuplicatePosts(placeNumber: string): Promise<Array<{
  normalizedUrl: string;
  type: 'blog' | 'insta';
  typeCode: string;
  count: number;
  duplicateRowIds: string[];
}>> {
  return withOperationLock(async () => {
    const loginResult = await login();
    if (!loginResult.ok) return [];
    const { reportId } = await getReportId(placeNumber);
    if (!reportId) return [];

    // 모든 페이지 순회
    let allPostHtml = '';
    const PAGE_SIZE = 500;
    for (let pg = 1; pg <= 10; pg++) {
      const postUrl = `${BASE_URL}/admin/post?reportId=${reportId}&placeNumber=${encodeURIComponent(placeNumber)}&page=${pg}&pageSize=${PAGE_SIZE}`;
      const postRes = await httpGet(postUrl);
      if (!postRes.body) break;
      const tbody = postRes.body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      if (!tbody) break;
      const rowCount = (tbody[1].match(/<tr[^>]*>/gi) || []).length;
      allPostHtml += tbody[1];
      if (rowCount < PAGE_SIZE) break;
    }

    const posts: PostRow[] = [];
    const rowMatches = Array.from(allPostHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
    for (const rm of rowMatches) {
      const rowHtml = rm[1];
      // rowId 추출: deleteBtn의 data-id가 가장 확실
      let rowId = '';
      let typeCode = '';
      const deleteBtnMatch = rowHtml.match(/deleteBtn[^>]*data-id=['"](\d+)['"][^>]*data-value=['"][^'"]+['"][^>]*data-type=['"]([^'"]+)['"]/i);
      if (deleteBtnMatch) {
        rowId = deleteBtnMatch[1];
        typeCode = deleteBtnMatch[2];
      } else {
        const idMatch = rowHtml.match(/deleteBtn[^>]*data-id=['"](\d+)['"]/i) || rowHtml.match(/data-id=['"](\d+)['"]/i);
        if (idMatch) rowId = idMatch[1];
        const typeMatch = rowHtml.match(/data-type=['"]([^'"]+)['"]/i);
        if (typeMatch) typeCode = typeMatch[1];
      }

      // URL 추출
      const dateMatch = rowHtml.match(/(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}/);
      const date = dateMatch ? dateMatch[1] : null;
      const urls = [
        ...Array.from(rowHtml.matchAll(/<a\s+href="(https?:\/\/[^"]+)"/gi)).map(m => m[1]),
        ...Array.from(rowHtml.matchAll(/https?:\/\/(?:blog\.naver\.com|www\.instagram\.com|m\.blog\.naver\.com)[^\s<"']+/gi)).map(m => m[0]),
      ];
      for (const url of urls) {
        const type: 'blog' | 'insta' | null =
          url.includes('instagram.com') ? 'insta'
          : (url.includes('blog.naver.com') || url.includes('post.naver.com') || url.includes('m.blog.naver.com')) ? 'blog'
          : null;
        if (!type) continue;
        if (!rowId) continue;
        posts.push({ rowId, typeCode: typeCode || (type === 'insta' ? '2' : '1'), url, type, date, rawHtml: rowHtml.substring(0, 500) });
        break;
      }
    }

    // 중복 그룹핑
    const groups = new Map<string, PostRow[]>();
    for (const p of posts) {
      const key = normalizePostUrl(p.url);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const result: Array<{ normalizedUrl: string; type: 'blog' | 'insta'; typeCode: string; count: number; duplicateRowIds: string[] }> = [];
    for (const [url, list] of groups) {
      if (list.length > 1) {
        result.push({
          normalizedUrl: url,
          type: list[0].type,
          typeCode: list[0].typeCode,
          count: list.length,
          duplicateRowIds: list.map(p => p.rowId),
        });
      }
    }
    return result;
  });
}

/**
 * 해당 placeNumber의 모집플레이스에 이미 동일 링크가 등록돼 있는지 확인.
 * 일괄등록 시 중복 방지용.
 */
export function isPostAlreadyRegistered(placeNumber: string, link: string): Promise<boolean> {
  return withOperationLock(async () => {
    const loginResult = await login();
    if (!loginResult.ok) return false;
    const { reportId } = await getReportId(placeNumber);
    if (!reportId) return false;
    const target = normalizePostUrl(link);
    // 1페이지만 확인 (가장 최근 게시물 포함) — pageSize 크게
    const postUrl = `${BASE_URL}/admin/post?reportId=${reportId}&placeNumber=${encodeURIComponent(placeNumber)}&page=1&pageSize=500`;
    const postRes = await httpGet(postUrl);
    if (!postRes.body) return false;
    const tbody = postRes.body.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbody) return false;
    const allHrefs = Array.from(tbody[1].matchAll(/<a\s+href="(https?:\/\/[^"]+)"/gi)).map(m => m[1]);
    const textUrls = Array.from(tbody[1].matchAll(/https?:\/\/(?:blog\.naver\.com|www\.instagram\.com|m\.blog\.naver\.com)[^\s<"']+/gi)).map(m => m[0]);
    return [...allHrefs, ...textUrls].some(u => normalizePostUrl(u) === target);
  });
}

/**
 * 임의 URL을 홈전산 세션으로 fetch (delete 엔드포인트 탐색용)
 */
export function probeUrl(url: string, matchPattern: string): Promise<{
  status: number;
  bodyLen: number;
  matches: string[];
  sample: string;
}> {
  return withOperationLock(async () => {
    const loginResult = await login();
    if (!loginResult.ok) return { status: 0, bodyLen: 0, matches: [], sample: 'login failed' };
    const target = url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
    const res = await httpGet(target);
    if (!res.body) return { status: res.status ?? 0, bodyLen: 0, matches: [], sample: '' };
    const re = new RegExp(matchPattern, 'gi');
    const matches: string[] = [];
    const body = res.body;
    let m;
    while ((m = re.exec(body)) !== null && matches.length < 20) {
      const idx = m.index;
      matches.push(body.substring(Math.max(0, idx - 200), idx + 600));
    }
    return { status: res.status ?? 200, bodyLen: body.length, matches, sample: body.substring(0, 500) };
  });
}

/**
 * 단일 post 삭제 시도 — 다양한 엔드포인트/메서드/payload 조합 실험
 */
export function tryDeletePost(opts: {
  postId: string;
  placeNumber: string;
  endpoint: string;   // e.g. /admin/post/delete/ or /admin/post/714281
  method: string;     // PATCH / POST / DELETE
  payloadType: string; // json-delYn | json-id | form-urlencoded | path-only
}): Promise<{ status: number; body: string; endpoint: string; method: string; payloadType: string }> {
  return withOperationLock(async () => {
    const loginResult = await login();
    if (!loginResult.ok) return { status: 0, body: 'login failed', endpoint: opts.endpoint, method: opts.method, payloadType: opts.payloadType };

    let targetUrl = opts.endpoint.startsWith('http') ? opts.endpoint : `${BASE_URL}${opts.endpoint.startsWith('/') ? '' : '/'}${opts.endpoint}`;
    // path-only 의 경우 endpoint에 postId 치환
    if (opts.payloadType === 'path-only') {
      if (!targetUrl.includes(opts.postId)) targetUrl = targetUrl.replace(/\/?$/, '/') + opts.postId;
    }

    let bodyInit: BodyInit | undefined;
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      'X-Requested-With': 'XMLHttpRequest',
      Cookie: getCookieHeader(),
    };

    if (opts.payloadType === 'json-delYn') {
      headers['Content-Type'] = 'application/json; charset=UTF-8';
      bodyInit = JSON.stringify({ postId: opts.postId, placeNumber: opts.placeNumber, delYn: 'X' });
    } else if (opts.payloadType === 'json-id') {
      headers['Content-Type'] = 'application/json; charset=UTF-8';
      bodyInit = JSON.stringify({ id: opts.postId });
    } else if (opts.payloadType === 'form-urlencoded') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      bodyInit = `postId=${encodeURIComponent(opts.postId)}&placeNumber=${encodeURIComponent(opts.placeNumber)}&delYn=X`;
    }
    // path-only: no body

    try {
      const res = await fetch(targetUrl, { method: opts.method, headers, body: bodyInit });
      collectCookies(res);
      const text = await res.text();
      return { status: res.status, body: text.substring(0, 1000), endpoint: targetUrl, method: opts.method, payloadType: opts.payloadType };
    } catch (e) {
      return { status: 0, body: String(e), endpoint: targetUrl, method: opts.method, payloadType: opts.payloadType };
    }
  });
}

/**
 * 게시물 삭제 — 모집플레이스 admin UI의 deleteBtn과 동일한 호출
 * DELETE /admin/post/ with JSON {postSeq, placeNumber, type}
 */
export function deletePostsByIds(
  targets: Array<{ rowId: string; typeCode: string }>,
  placeNumber: string,
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  details: Array<{ rowId: string; ok: boolean; message: string }>;
}> {
  return withOperationLock(async () => {
    const loginResult = await login();
    if (!loginResult.ok) {
      return { attempted: targets.length, succeeded: 0, failed: targets.length, details: targets.map(t => ({ rowId: t.rowId, ok: false, message: 'login failed' })) };
    }

    const details: Array<{ rowId: string; ok: boolean; message: string }> = [];
    let succeeded = 0;
    let failed = 0;

    for (const t of targets) {
      try {
        const res = await fetch(`${BASE_URL}/admin/post/`, {
          method: 'DELETE',
          headers: {
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Cookie: getCookieHeader(),
          },
          body: JSON.stringify({ postSeq: t.rowId, placeNumber, type: t.typeCode }),
        });
        collectCookies(res);
        const text = await res.text();
        const json = tryParseJson(text);
        if (json?.success || json?.result === 'success') {
          succeeded++;
          details.push({ rowId: t.rowId, ok: true, message: json?.msg ? String(json.msg) : 'deleted' });
        } else {
          failed++;
          details.push({ rowId: t.rowId, ok: false, message: json?.msg ? String(json.msg) : `HTTP ${res.status}: ${text.substring(0, 200)}` });
        }
        await sleep(200);
      } catch (e) {
        failed++;
        details.push({ rowId: t.rowId, ok: false, message: String(e) });
      }
    }

    return { attempted: targets.length, succeeded, failed, details };
  });
}
