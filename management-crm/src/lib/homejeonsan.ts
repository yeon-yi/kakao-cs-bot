/**
 * homejeonsan.ts - 모집플레이스.com(홈전산) 커넥터
 *
 * DupDBConnector.php를 Node.js fetch 기반으로 포팅.
 * 세션 쿠키 기반 인증, HTML 테이블 파싱으로 데이터 추출.
 */

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
} as const;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const SESSION_TTL_MS = 5 * 60 * 1000;

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

async function httpGet(url: string): Promise<HttpResult> {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Cache-Control': 'no-cache',
      Cookie: getCookieHeader(),
    },
    redirect: 'follow',
  });
  collectCookies(res);
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function httpPost(url: string, data: Record<string, string>): Promise<HttpResult> {
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
  });
  collectCookies(res);
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function httpAjaxPost(
  url: string,
  data: Record<string, string>,
  referer?: string,
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

export async function login(): Promise<LoginResult> {
  // DB에서 최신 계정 정보 동기화 (환경변수 미설정 시)
  if (!process.env.HOMEJEONSAN_ID) {
    try {
      const { prisma: db } = require('@/lib/prisma');
      const rows = await db.systemSetting.findMany({ where: { key: { in: ['HOMEJEONSAN_ID', 'HOMEJEONSAN_PW', 'HOMEJEONSAN_PW2'] } } });
      for (const r of rows) process.env[r.key] = r.value;
    } catch { /* 첫 실행 시 테이블 없을 수 있음 */ }
  }

  // 5분 이내 세션 재사용
  if (session.loggedIn && Date.now() - session.lastLogin < SESSION_TTL_MS) {
    return { ok: true, message: '세션 재사용' };
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

export async function searchKeywords(
  placeNumber: string,
): Promise<{ success: boolean; keywords: KeywordEntry[]; total: number; error?: string }> {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, keywords: [], total: 0, error: 'login failed' };

  try {
    const url = `${ENDPOINTS.KEYWORD_LIST}?page=1&pageSize=200&searchType=place_number&searchKeyword=${encodeURIComponent(placeNumber)}`;
    const res = await httpGet(url);
    if (!res.body) return { success: false, keywords: [], total: 0, error: 'no response' };

    const keywords: KeywordEntry[] = [];
    const trParts = res.body.split(/<tr[^>]*>/i);

    for (const part of trParts) {
      if (!part.includes(placeNumber)) continue;
      const cells = parseTdCells(part);
      // [0]checkbox [1]No [2]date [3]businessName [4]keyword [5]firstRank [6]currentRank ... [9]placeNumber ... [11]staff
      if (cells.length >= 12 && cells[9] === placeNumber) {
        keywords.push({
          keyword: cells[4] || '',
          firstRank: cells[5] || '',
          rank: cells[6] || '',
          staffName: cells[11] || '',
          date: cells[2] || '',
          adType: cells.length > 18 ? cells[18] || '' : '정상',
        });
      }
    }

    return { success: true, keywords, total: keywords.length };
  } catch (e) {
    return { success: false, keywords: [], total: 0, error: String(e) };
  }
}

export async function registerKeyword(params: RegisterKeywordParams): Promise<RegisterResult> {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: `로그인 실패: ${loginResult.error || ''}` };

  const postData: Record<string, string> = {
    placeName: params.businessName,
    placeNumber: params.placeId,
    keyword: params.keyword,
    category: CATEGORY_MAP[params.category] || '7',
    salesMemberName: params.staffName,
    advertisementType: params.adType || '정상',
  };

  return withRetry(async () => {
    const res = await httpAjaxPost(ENDPOINTS.KEYWORD_ADD, postData, ENDPOINTS.KEYWORD_ADD);
    if (!res.body) return null;

    const json = tryParseJson(res.body);
    if (json) {
      if (json.success || json.result === 'success') {
        return { success: true, message: '키워드 등록 완료' };
      }
      const failMsg = extractFailMessage(json) || '등록 실패';
      return { success: false, message: failMsg, duplicate: isDuplicateMessage(failMsg) };
    }

    if (res.status === 200 || res.status === 302) {
      return { success: true, message: '키워드 등록 완료' };
    }
    return { success: false, message: `등록 실패: HTTP ${res.status}` };
  }, { success: false, message: '등록 실패 (최대 재시도 초과)' });
}

export async function deleteKeyword(rowId: string): Promise<{ success: boolean; message: string }> {
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
}

export async function findRowIds(placeNumber: string, keyword?: string): Promise<string[]> {
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
        if (chunk.includes(`>${keyword}<`) || chunk.includes(`/search/${encodeURIComponent(keyword)}`)) {
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
}

// -- 리포트 --

export async function checkReport(
  placeNumber: string,
): Promise<{ exists: boolean; contractPeriod?: string; reportUrl?: string; error?: string }> {
  const loginResult = await login();
  if (!loginResult.ok) return { exists: false, error: 'login failed' };

  try {
    const url = `${ENDPOINTS.REPORT}?selectedMenu=2&searchType=placeId&searchKeyword=${encodeURIComponent(placeNumber)}`;
    const res = await httpGet(url);
    if (!res.body) return { exists: false };

    const trParts = res.body.split(/<tr[^>]*>/i);

    for (const part of trParts) {
      const cells = parseTdCells(part);
      // [0]placeNumber [1]placeName [2]score [3]reportURL ... [6]contractPeriod
      if (cells.length >= 7 && cells[0] === placeNumber) {
        return { exists: true, contractPeriod: cells[6] || '', reportUrl: cells[3] || '' };
      }
    }
    return { exists: false };
  } catch (e) {
    return { exists: false, error: String(e) };
  }
}

export async function registerReport(params: RegisterReportParams): Promise<RegisterResult> {
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
    console.log('[registerReport] postData:', JSON.stringify(postData));
    const res = await httpAjaxPost(ENDPOINTS.REPORT, postData, ENDPOINTS.REPORT + '/add');
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
    return { success: false, message: `리포트 등록 실패: HTTP ${res.status}` };
  }, { success: false, message: '리포트 등록 실패 (최대 재시도 초과)' });
}

// -- 중복DB --

export async function searchDupDB(keyword: string): Promise<SearchResult> {
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

export interface RegisterDupParams {
  businessName: string;
  placeId: string;
  category: string;
}

export async function registerDup(params: RegisterDupParams): Promise<RegisterResult> {
  const loginResult = await login();
  if (!loginResult.ok) return { success: false, message: `로그인 실패: ${loginResult.error || ''}` };

  // 기존 등록 여부 확인
  const existing = await searchDupDB(params.placeId);
  if (existing.ok && existing.items.some((item) => item.placeId === params.placeId)) {
    return { success: false, message: '이미 등록된 플레이스 번호입니다.', duplicate: true };
  }

  const postData: Record<string, string> = {
    placeName: params.businessName,
    placeNumber: params.placeId,
    category: CATEGORY_MAP[params.category] || '7',
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
}
