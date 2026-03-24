'use client';

import { useEffect, useState, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, apiPut } from '@/lib/api-client';
import { VIDEO_TYPES } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface User {
  userId: number;
  username: string;
  displayName: string;
  role: string;
  branch: string;
}

interface Company {
  id: number;
  sourceId: number;
  registrant: string;
  paymentDate: string;
  companyName: string;
  representative: string;
  phone: string;
  staffName: string;
  managerName: string;
  branch: string | null;
  status: string;
  placeId: string | null;
}

interface Setting {
  id: number;
  companyId: number;
  contractStart: string | null;
  contractEnd: string | null;
  isHolding: boolean;
  hasReward: boolean;
  blogTarget: number;
  instaTarget: number;
  hasHomepage: boolean;
  hasReport: boolean;
  hasSeo: boolean;
  videoType: 'none' | 'premium' | 'short';
}

interface Progress {
  id: number;
  companyId: number;
  rewardDone: boolean;
  blogCount: number;
  instaCount: number;
  homepageDone: boolean;
  reportDone: boolean;
  seoDone: boolean;
  videoDone: boolean;
}

interface LogEntry {
  id: number;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
  user: { displayName: string };
}

interface Memo {
  id: number;
  content: string;
  createdAt: string;
  userId: number;
  user: { displayName: string };
}

interface CompanyDetailResponse {
  company: Company & {
    setting: Setting | null;
    progress: Progress | null;
    logs: LogEntry[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOMEJEONSAN_CATEGORIES = [
  '맛집/카페',
  '중장비/자동차',
  '뷰티/미용',
  '꽃집/스튜디오',
  '부동산/학원',
  '인테리어/청소',
  '점집/헬스,운동',
  '기타',
];

const STEP_LABELS = [
  { num: 1, label: '솔루션 설정' },
  { num: 2, label: '홈전산 등록' },
  { num: 3, label: '리포트 등록' },
  { num: 4, label: '진행 관리' },
];

// ---------------------------------------------------------------------------
// Field name label mapping
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  isHolding: '홀딩',
  hasReward: '리워드',
  blogTarget: '블로그 목표',
  instaTarget: '인스타 목표',
  hasHomepage: '홈페이지',
  videoType: '영상제작',
  contractStart: '계약시작',
  contractEnd: '계약종료',
  rewardDone: '리워드 완료',
  blogCount: '블로그 진행',
  instaCount: '인스타 진행',
  homepageDone: '홈페이지 완료',
  videoDone: '영상 완료',
  hasReport: '리포트',
  hasSeo: 'SEO',
  reportDone: '리포트 완료',
  seoDone: 'SEO 완료',
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function calcProgress(setting: Setting | null, progress: Progress | null): { done: number; total: number; pct: number } {
  if (!setting || !progress) return { done: 0, total: 0, pct: 0 };
  let total = 0, done = 0;
  // 리워드/리포트/SEO 제외 (항상 기본 포함 또는 폐지)
  if (setting.blogTarget > 0) { total++; if (progress.blogCount >= setting.blogTarget) done++; }
  if (setting.instaTarget > 0) { total++; if (progress.instaCount >= setting.instaTarget) done++; }
  if (setting.hasHomepage) { total++; if (progress.homepageDone) done++; }
  if (setting.videoType !== 'none') { total++; if (progress.videoDone) done++; }
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}

function groupLogsByDate(logs: LogEntry[]): Map<string, LogEntry[]> {
  const map = new Map<string, LogEntry[]>();
  for (const log of logs) {
    const date = new Date(log.createdAt).toISOString().split('T')[0];
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(log);
  }
  return map;
}

function toDateStr(v: string | null | undefined): string {
  if (!v) return '';
  return v.slice(0, 10);
}

function addMonths(dateStr: string, months: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function calcMonthsDiff(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (months < 1 || months > 60) return 0;
  return months;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function displayValue(fieldName: string, value: string | null): string {
  if (value === null || value === '') return '-';
  if (fieldName === 'videoType' || fieldName === '영상타입') {
    const videoMap: Record<string, string> = { none: '없음', premium: '프리미엄', short: '숏폼', ...VIDEO_TYPES };
    return videoMap[value] ?? value;
  }
  const booleanFields = ['isHolding', 'hasReward', 'hasHomepage', 'hasReport', 'hasSeo', 'rewardDone', 'homepageDone', 'reportDone', 'seoDone', 'videoDone',
    '홀딩', '리워드', '홈페이지', '리워드 완료', '홈페이지 완료', '영상 완료', '리포트', 'SEO', '리포트 완료', 'SEO 완료'];
  if (booleanFields.includes(fieldName)) {
    if (value === 'true' || value === 'Y' || value === 'O') return 'O';
    if (value === 'false' || value === 'N' || value === 'X') return 'X';
  }
  if (['contractStart', 'contractEnd', '계약시작일', '계약종료일'].includes(fieldName)) {
    return toDateStr(value);
  }
  return value;
}

const CAN_EDIT_ROLES = ['admin', 'manager_team', 'branch_manager', 'manager'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Step guide state
  const [activeStep, setActiveStep] = useState(1);

  // Setting form state
  const [settingForm, setSettingForm] = useState({
    contractStart: '',
    contractEnd: '',
    isHolding: false,
    hasReward: true,
    blogTarget: 180,
    instaTarget: 12,
    hasHomepage: true,
    hasReport: false,
    hasSeo: false,
    videoType: 'premium' as 'none' | 'premium' | 'short',
  });

  const [contractMonths, setContractMonths] = useState<number | ''>(12);

  // Progress form state
  const [progressForm, setProgressForm] = useState({
    rewardDone: false,
    blogCount: 0,
    instaCount: 0,
    homepageDone: false,
    reportDone: false,
    seoDone: false,
    videoDone: false,
  });

  const [settingSaving, setSettingSaving] = useState(false);
  const [settingMsg, setSettingMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [progressSaving, setProgressSaving] = useState(false);
  const [progressMsg, setProgressMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [logLimit, setLogLimit] = useState(50);

  // Memos
  const [memos, setMemos] = useState<Memo[]>([]);
  const [memoText, setMemoText] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);

  // Step 2: Homejeonsan keyword registration
  const [hjKeywords, setHjKeywords] = useState('');
  const [hjCategory, setHjCategory] = useState(HOMEJEONSAN_CATEGORIES[0]);
  const [hjAdType, setHjAdType] = useState('정상');
  const [hjPlaceId, setHjPlaceId] = useState('');
  const [hjSaving, setHjSaving] = useState(false);
  const [hjMsg, setHjMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [hjResults, setHjResults] = useState<Array<{ keyword: string; success: boolean; message: string }>>([]);
  const [hjDone, setHjDone] = useState(false);

  // Step 3: Report registration
  const [rpPlaceId, setRpPlaceId] = useState('');
  const [rpPhone, setRpPhone] = useState('');
  const [rpContractStart, setRpContractStart] = useState('');
  const [rpMonths, setRpMonths] = useState<number>(6);
  const [rpSaving, setRpSaving] = useState(false);
  const [rpMsg, setRpMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [rpDone, setRpDone] = useState(false);

  // Validation refs
  const hjKeywordsRef = useRef<HTMLInputElement>(null);
  const hjPlaceIdRef = useRef<HTMLInputElement>(null);
  const rpPlaceIdRef = useRef<HTMLInputElement>(null);
  const rpPhoneRef = useRef<HTMLInputElement>(null);
  const rpContractStartRef = useRef<HTMLInputElement>(null);

  // Validation error state
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});

  const canEdit = user ? CAN_EDIT_ROLES.includes(user.role) : false;
  const canEditProgress = user ? ['admin', 'manager_team'].includes(user.role) : false;

  // Step completion check
  const isStepComplete = (step: number): boolean => {
    switch (step) {
      case 1: return setting !== null;
      case 2: return hjDone;
      case 3: return rpDone;
      case 4: return true;
      default: return false;
    }
  };

  // Fetch session
  useEffect(() => {
    apiGet<{ user: User }>('/api/auth')
      .then((d) => setUser(d.user))
      .catch(() => {
        /* middleware handles redirect */
      });
  }, []);

  // Fetch company data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiGet<CompanyDetailResponse>(`/api/companies/${id}`);
      const c = data.company;
      setCompany(c);
      setSetting(c.setting);
      setProgress(c.progress);
      setLogs(c.logs ?? []);

      if (c.setting) {
        const start = toDateStr(c.setting.contractStart);
        const end = toDateStr(c.setting.contractEnd);
        setSettingForm({
          contractStart: start,
          contractEnd: end,
          isHolding: c.setting.isHolding,
          hasReward: c.setting.hasReward,
          blogTarget: c.setting.blogTarget,
          instaTarget: c.setting.instaTarget,
          hasHomepage: c.setting.hasHomepage,
          hasReport: c.setting.hasReport,
          hasSeo: c.setting.hasSeo,
          videoType: c.setting.videoType,
        });
        if (start && end) {
          setContractMonths(calcMonthsDiff(start, end));
        }
        // Pre-fill report fields from setting
        if (start) setRpContractStart(start);
        if (start && end) {
          const m = calcMonthsDiff(start, end);
          if (m > 0) setRpMonths(m);
        }
      } else {
        // 신규: 기본값 적용
        const payDate = toDateStr(c.paymentDate);
        const defaultVideo = c.branch === '동탄' ? 'short' : 'premium';
        if (payDate) {
          const startD = new Date(payDate);
          const endD = new Date(startD);
          endD.setMonth(endD.getMonth() + 12);
          const endStr = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
          setSettingForm(prev => ({
            ...prev,
            contractStart: payDate,
            contractEnd: endStr,
            videoType: defaultVideo as 'none' | 'premium' | 'short',
          }));
          setContractMonths(12);
        } else {
          setSettingForm(prev => ({ ...prev, videoType: defaultVideo as 'none' | 'premium' | 'short' }));
        }
      }

      // Pre-fill phone for report
      if (c.phone) setRpPhone(c.phone);

      if (c.progress) {
        setProgressForm({
          rewardDone: c.progress.rewardDone,
          blogCount: c.progress.blogCount,
          instaCount: c.progress.instaCount,
          homepageDone: c.progress.homepageDone,
          reportDone: c.progress.reportDone,
          seoDone: c.progress.seoDone,
          videoDone: c.progress.videoDone,
        });
      }

      // 스텝 3까지 완료 상태 확인 → placeId가 있으면 키워드 등록됨으로 간주
      if (c.setting && c.placeId) {
        setHjDone(true);
        setHjPlaceId(c.placeId);
        // 리포트 등록 여부는 홈전산 API로 확인
        try {
          const searchRes = await fetch(`/api/homejeonsan?action=search_place&placeNumber=${encodeURIComponent(c.placeId)}`, { credentials: 'include' });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.reportExists) {
              setRpDone(true);
              // 스텝 3까지 완료 → 스텝 4로 자동 이동
              setActiveStep(4);
            } else if (searchData.keywordCount > 0) {
              // 키워드만 등록됨 → 스텝 3으로
              setActiveStep(3);
            }
          }
        } catch { /* 조회 실패 시 무시 */ }
      } else if (c.setting) {
        // 설정만 있고 placeId 없음 → 스텝 2로
        setActiveStep(2);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '데이터를 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchMemos = useCallback(async () => {
    try {
      const res = await apiGet<{ memos: Memo[] }>(`/api/companies/${id}/memos`);
      setMemos(res.memos ?? []);
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    fetchData();
    fetchMemos();
  }, [fetchData, fetchMemos]);

  // Sync placeId between Step 2 and Step 3
  useEffect(() => {
    if (hjPlaceId && !rpPlaceId) {
      setRpPlaceId(hjPlaceId);
    }
  }, [hjPlaceId, rpPlaceId]);

  // ---------------------------------------------------------------------------
  // Validation helper
  // ---------------------------------------------------------------------------
  function validateAndHighlight(fields: { key: string; ref: React.RefObject<HTMLInputElement | null>; value: string }[]): boolean {
    let valid = true;
    const errors: Record<string, boolean> = {};
    for (const field of fields) {
      if (!field.value?.trim()) {
        errors[field.key] = true;
        if (field.ref.current) {
          field.ref.current.style.borderColor = '#dc2626';
          field.ref.current.style.animation = 'shake 0.3s';
          setTimeout(() => {
            if (field.ref.current) {
              field.ref.current.style.animation = '';
            }
          }, 300);
        }
        valid = false;
      } else {
        errors[field.key] = false;
        if (field.ref.current) {
          field.ref.current.style.borderColor = '#e2e8f0';
        }
      }
    }
    setValidationErrors(prev => ({ ...prev, ...errors }));
    return valid;
  }

  // Save settings
  async function handleSaveSetting() {
    setSettingSaving(true);
    setSettingMsg(null);
    try {
      await apiPost(`/api/companies/${id}/settings`, settingForm);
      setSettingMsg({ type: 'ok', text: '설정이 저장되었습니다.' });
      await fetchData();
    } catch (e: unknown) {
      setSettingMsg({ type: 'err', text: e instanceof Error ? e.message : '저장에 실패했습니다.' });
    } finally {
      setSettingSaving(false);
    }
  }

  // Add memo
  async function handleAddMemo() {
    if (!memoText.trim()) return;
    setMemoSaving(true);
    try {
      await apiPost(`/api/companies/${id}/memos`, { content: memoText.trim() });
      setMemoText('');
      await fetchMemos();
    } catch { /* ignore */ }
    finally { setMemoSaving(false); }
  }

  // Delete memo
  async function handleDeleteMemo(memoId: number) {
    if (!confirm('메모를 삭제하시겠습니까?')) return;
    try {
      await fetch(`/api/companies/${id}/memos?memoId=${memoId}`, { method: 'DELETE', credentials: 'include' });
      await fetchMemos();
    } catch { /* ignore */ }
  }

  // Save progress
  async function handleSaveProgress() {
    setProgressSaving(true);
    setProgressMsg(null);
    try {
      await apiPut(`/api/companies/${id}/progress`, progressForm);
      setProgressMsg({ type: 'ok', text: '진행 상황이 저장되었습니다.' });
      await fetchData();
    } catch (e: unknown) {
      setProgressMsg({ type: 'err', text: e instanceof Error ? e.message : '저장에 실패했습니다.' });
    } finally {
      setProgressSaving(false);
    }
  }

  // Step 2: Register keywords to homejeonsan
  async function handleKeywordRegister() {
    const isValid = validateAndHighlight([
      { key: 'hjKeywords', ref: hjKeywordsRef, value: hjKeywords },
      { key: 'hjPlaceId', ref: hjPlaceIdRef, value: hjPlaceId },
    ]);
    if (!isValid) return;

    setHjSaving(true);
    setHjMsg(null);
    setHjResults([]);

    const keywords = hjKeywords.split(',').map(k => k.trim()).filter(k => k);
    if (keywords.length === 0) {
      setHjMsg({ type: 'err', text: '키워드를 입력하세요.' });
      setHjSaving(false);
      return;
    }

    const results: Array<{ keyword: string; success: boolean; message: string }> = [];
    let successCount = 0;

    for (const keyword of keywords) {
      try {
        const res = await fetch('/api/homejeonsan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            action: 'register',
            businessName: company?.companyName || '',
            keyword,
            placeId: hjPlaceId,
            category: hjCategory,
            staffName: company?.staffName || '',
            adType: hjAdType,
          }),
        });
        const result = await res.json();
        results.push({ keyword, success: result.success, message: result.message });
        if (result.success) successCount++;
      } catch {
        results.push({ keyword, success: false, message: '요청 실패' });
      }
    }

    setHjResults(results);
    if (successCount === keywords.length) {
      setHjMsg({ type: 'ok', text: `${successCount}건 모두 등록 완료` });
      setHjDone(true);
      // placeId를 Company에 저장
      if (hjPlaceId && company) {
        fetch(`/api/companies/${company.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ placeId: hjPlaceId }),
        }).catch(() => {});
      }
      // Sync placeId to step 3
      setRpPlaceId(hjPlaceId);
    } else {
      setHjMsg({ type: 'err', text: `${keywords.length}건 중 ${successCount}건 성공, ${keywords.length - successCount}건 실패` });
    }
    setHjSaving(false);
  }

  // Step 3: Register report to homejeonsan
  async function handleReportRegister() {
    const isValid = validateAndHighlight([
      { key: 'rpPlaceId', ref: rpPlaceIdRef, value: rpPlaceId },
      { key: 'rpPhone', ref: rpPhoneRef, value: rpPhone },
      { key: 'rpContractStart', ref: rpContractStartRef, value: rpContractStart },
    ]);
    if (!isValid) return;

    setRpSaving(true);
    setRpMsg(null);

    try {
      const res = await fetch('/api/homejeonsan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'register_report',
          placeId: rpPlaceId,
          phone1: rpPhone,
          contractStart: rpContractStart,
          months: rpMonths,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setRpMsg({ type: 'ok', text: '리포트 등록 완료' });
        setRpDone(true);
      } else {
        setRpMsg({ type: 'err', text: result.message || '리포트 등록 실패' });
      }
    } catch {
      setRpMsg({ type: 'err', text: '요청 실패' });
    } finally {
      setRpSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Loading / Error states
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="text-center">
          <div
            className="w-8 h-8 mx-auto mb-3"
            style={{
              border: '3px solid #e2e8f0',
              borderTop: '3px solid #2563eb',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span className="text-[#64748b] text-sm">불러오는 중...</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error || !company) {
    return (
      <div className="p-8">
        <Link
          href="/companies"
          className="inline-flex items-center gap-1.5 text-sm text-[#64748b] no-underline mb-6"
          style={{ fontFamily: 'inherit' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
          목록으로
        </Link>
        <div
          className="py-4 px-5 text-sm text-[#dc2626]"
          style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca' }}
        >
          {error || '업체 정보를 찾을 수 없습니다.'}
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div
      className="min-h-full"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
        backgroundColor: '#f8fafc',
      }}
    >
      {/* Shake animation + step indicator styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
      `}</style>

      {/* Header */}
      <header
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '20px 32px',
        }}
      >
        <Link
          href="/companies"
          className="inline-flex items-center gap-1.5 text-[13px] text-[#64748b] no-underline mb-3"
          style={{ transition: 'color 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#334155'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b'; }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
          </svg>
          목록으로
        </Link>
        <div className="flex items-center gap-3">
          <h1
            style={{
              fontSize: '22px',
              fontWeight: 700,
              color: '#0f172a',
              letterSpacing: '-0.02em',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            {company.companyName}
          </h1>
          {company.branch && (
            <span
              style={{
                display: 'inline-block',
                padding: '3px 10px',
                fontSize: '12px',
                fontWeight: 600,
                color: '#1e40af',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                lineHeight: 1.4,
              }}
            >
              {company.branch}
            </span>
          )}
          {setting?.contractEnd && (() => {
            const dday = Math.ceil((new Date(setting.contractEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const color = dday <= 0 ? '#dc2626' : dday <= 7 ? '#dc2626' : dday <= 30 ? '#d97706' : '#16a34a';
            const bg = dday <= 0 ? '#fef2f2' : dday <= 7 ? '#fef2f2' : dday <= 30 ? '#fffbeb' : '#f0fdf4';
            const borderColor = dday <= 7 ? '#fecaca' : dday <= 30 ? '#fde68a' : '#bbf7d0';
            const label = dday <= 0 ? `D+${Math.abs(dday)} (만료)` : `D-${dday}`;
            return (
              <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: '12px', fontWeight: 600, color, backgroundColor: bg, border: `1px solid ${borderColor}` }}>
                {label}
              </span>
            );
          })()}
          {company.status === 'churned' && <span style={{ display: 'inline-block', padding: '3px 10px', fontSize: '12px', fontWeight: 600, color: '#dc2626', backgroundColor: '#fecaca', border: '1px solid #fca5a5' }}>해지</span>}
          {canEdit && (
            <select value={company.status || 'completed'}
              onChange={async (e) => {
                const v = e.target.value;
                const labels: Record<string, string> = { completed: '계약완료', churned: '해지' };
                if (!confirm(`상태를 "${labels[v]}"(으)로 변경하시겠습니까?`)) { e.target.value = company.status || 'completed'; return; }
                const res = await fetch(`/api/companies/${company.id}/status`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: v }) });
                if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.message || '상태 변경 실패'); e.target.value = company.status || 'completed'; return; }
                fetchData();
              }}
              style={{ padding: '3px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
              <option value="completed">계약완료</option>
              <option value="churned">해지</option>
            </select>
          )}
        </div>
      </header>

      <div style={{ padding: '24px 32px 48px', maxWidth: '960px' }}>
        {/* Section: 업체 정보 */}
        <section style={{ marginBottom: '24px' }}>
          <h2 style={sectionTitleStyle}>업체 정보</h2>
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              padding: '20px 24px',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '14px 32px',
              }}
            >
              <InfoRow label="업체명" value={company.companyName} />
              <InfoRow label="대표자" value={company.representative} />
              <InfoRow label="연락처" value={company.phone} />
              <InfoRow label="등록자" value={company.registrant} />
              <InfoRow label="결제일" value={toDateStr(company.paymentDate)} />
              <InfoRow label="담당자" value={company.staffName} />
              <InfoRow label="담당간부" value={company.managerName} />
            </div>
          </div>
        </section>

        {/* Solution Progress Bar */}
        {setting && progress && (() => {
          const { done, total, pct } = calcProgress(setting, progress);
          return (
            <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', padding: '20px', marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', margin: 0 }}>솔루션 진행률</h3>
                <span style={{ fontSize: '24px', fontWeight: 700, color: pct === 100 ? '#16a34a' : '#2563eb' }}>{pct}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', backgroundColor: pct === 100 ? '#22c55e' : '#2563eb', borderRadius: '4px', transition: 'width 0.3s' }} />
              </div>
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#64748b' }}>{done}/{total} 항목 완료</div>
            </div>
          );
        })()}

        {/* ============================================================= */}
        {/* Step Indicator                                                 */}
        {/* ============================================================= */}
        <div style={{
          backgroundColor: '#fff',
          border: '1px solid #e2e8f0',
          padding: '20px 24px',
          marginBottom: '24px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'relative',
          }}>
            {/* Background connecting line */}
            <div style={{
              position: 'absolute',
              top: '18px',
              left: '40px',
              right: '40px',
              height: '2px',
              backgroundColor: '#e2e8f0',
              zIndex: 0,
            }} />

            {STEP_LABELS.map((step) => {
              const complete = isStepComplete(step.num);
              const active = activeStep === step.num;
              const bgColor = active ? '#2563eb' : complete ? '#22c55e' : '#e2e8f0';
              const textColor = active ? '#ffffff' : complete ? '#ffffff' : '#94a3b8';
              const labelColor = active ? '#2563eb' : complete ? '#16a34a' : '#94a3b8';

              return (
                <div
                  key={step.num}
                  onClick={() => { if (step.num === 1 || isStepComplete(step.num - 1)) setActiveStep(step.num); }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    cursor: (step.num === 1 || isStepComplete(step.num - 1)) ? 'pointer' : 'not-allowed',
                    opacity: (step.num === 1 || isStepComplete(step.num - 1)) ? 1 : 0.5,
                    zIndex: 2,
                    position: 'relative',
                  }}
                >
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    backgroundColor: bgColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: textColor,
                    border: active ? '2px solid #2563eb' : complete ? '2px solid #22c55e' : '2px solid #e2e8f0',
                    transition: 'all 0.2s',
                    boxShadow: active ? '0 0 0 4px rgba(37, 99, 235, 0.15)' : 'none',
                  }}>
                    {complete && !active ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8.5L6.5 12L13 4" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : step.num}
                  </div>
                  <span style={{
                    marginTop: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: labelColor,
                    whiteSpace: 'nowrap',
                    transition: 'color 0.2s',
                  }}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ============================================================= */}
        {/* Step 1: 솔루션 설정                                            */}
        {/* ============================================================= */}
        {activeStep === 1 && (
          <section style={{ marginBottom: '24px' }}>
            <h2 style={sectionTitleStyle}>Step 1. 솔루션 설정</h2>
            <div style={cardStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 32px' }}>
                {/* 계약기간 */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>계약기간</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="date"
                      disabled={!canEdit}
                      value={settingForm.contractStart}
                      onChange={(e) => {
                        const start = e.target.value;
                        const end = (start && contractMonths) ? addMonths(start, Number(contractMonths)) : settingForm.contractEnd;
                        setSettingForm({ ...settingForm, contractStart: start, contractEnd: end });
                      }}
                      style={{ ...inputStyle(!canEdit), width: '160px' }}
                    />
                    <span style={{ color: '#94a3b8', fontSize: '13px', flexShrink: 0 }}>~</span>
                    <input
                      type="date"
                      disabled={!canEdit}
                      value={settingForm.contractEnd}
                      onChange={(e) => {
                        const end = e.target.value;
                        setSettingForm({ ...settingForm, contractEnd: end });
                        if (settingForm.contractStart && end) {
                          const months = calcMonthsDiff(settingForm.contractStart, end);
                          setContractMonths(months >= 1 && months <= 60 ? months : '');
                        } else {
                          setContractMonths('');
                        }
                      }}
                      style={{ ...inputStyle(!canEdit), width: '160px' }}
                    />
                  </div>
                </div>

                {/* 계약개월수 */}
                <div>
                  <label style={labelStyle}>계약개월수</label>
                  <select
                    disabled={!canEdit}
                    value={contractMonths}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) { setContractMonths(''); return; }
                      const months = parseInt(val);
                      setContractMonths(months);
                      if (settingForm.contractStart) {
                        setSettingForm(prev => ({
                          ...prev,
                          contractEnd: addMonths(prev.contractStart, months),
                        }));
                      }
                    }}
                    style={{ ...inputStyle(!canEdit), cursor: canEdit ? 'pointer' : 'default' }}
                  >
                    <option value="">선택</option>
                    {Array.from({ length: 60 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{m}개월</option>
                    ))}
                  </select>
                </div>

                {/* 홀딩 */}
                <div>
                  <label style={labelStyle}>홀딩</label>
                  <ToggleSwitch
                    value={settingForm.isHolding}
                    disabled={!canEdit}
                    onChange={(v) => setSettingForm({ ...settingForm, isHolding: v })}
                  />
                </div>

                {/* 블로그리뷰 */}
                <div>
                  <label style={labelStyle}>블로그리뷰 (목표 건수)</label>
                  <input
                    type="number"
                    min={0}
                    disabled={!canEdit}
                    value={settingForm.blogTarget}
                    onChange={(e) => setSettingForm({ ...settingForm, blogTarget: Math.max(0, parseInt(e.target.value) || 0) })}
                    style={inputStyle(!canEdit)}
                  />
                  <span style={hintStyle}>{settingForm.blogTarget === 0 ? '0 = 미해당' : `${settingForm.blogTarget}건`}</span>
                </div>

                {/* 인스타 */}
                <div>
                  <label style={labelStyle}>인스타 (목표 건수)</label>
                  <input
                    type="number"
                    min={0}
                    disabled={!canEdit}
                    value={settingForm.instaTarget}
                    onChange={(e) => setSettingForm({ ...settingForm, instaTarget: Math.max(0, parseInt(e.target.value) || 0) })}
                    style={inputStyle(!canEdit)}
                  />
                  <span style={hintStyle}>{settingForm.instaTarget === 0 ? '0 = 미해당' : `${settingForm.instaTarget}건`}</span>
                </div>

                {/* 홈페이지 */}
                <div>
                  <label style={labelStyle}>홈페이지</label>
                  <CheckboxField
                    checked={settingForm.hasHomepage}
                    disabled={!canEdit}
                    labelOn="해당"
                    labelOff="미해당"
                    onChange={(v) => setSettingForm({ ...settingForm, hasHomepage: v })}
                  />
                </div>

                {/* SEO — 숨김 처리, hasSeo 삭제됨 */}
                <div style={{ display: 'none' }}>
                  <CheckboxField
                    checked={settingForm.hasSeo}
                    disabled={!canEdit}
                    labelOn="해당"
                    labelOff="미해당"
                    onChange={(v) => setSettingForm({ ...settingForm, hasSeo: v })}
                  />
                </div>

                {/* 영상제작 */}
                <div>
                  <label style={labelStyle}>영상제작</label>
                  <div className="flex gap-4">
                    {(['none', 'premium', 'short'] as const).map((v) => (
                      <label
                        key={v}
                        className="flex items-center gap-1.5 cursor-pointer"
                        style={{ fontSize: '13px', color: '#334155' }}
                      >
                        <input
                          type="radio"
                          name="videoType"
                          disabled={!canEdit}
                          checked={settingForm.videoType === v}
                          onChange={() => setSettingForm({ ...settingForm, videoType: v })}
                          style={{ accentColor: '#2563eb' }}
                        />
                        {VIDEO_TYPES[v]}
                      </label>
                    ))}
                  </div>
                </div>

              </div>

              {/* Save button */}
              {canEdit && (
                <div className="flex items-center gap-3" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    disabled={settingSaving}
                    onClick={handleSaveSetting}
                    style={primaryBtnStyle(settingSaving)}
                    onMouseEnter={(e) => { if (!settingSaving) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                    onMouseLeave={(e) => { if (!settingSaving) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                  >
                    {settingSaving ? '저장 중...' : '설정 저장'}
                  </button>
                  {settingMsg && (
                    <span style={{ fontSize: '13px', color: settingMsg.type === 'ok' ? '#16a34a' : '#dc2626' }}>
                      {settingMsg.text}
                    </span>
                  )}
                  {setting && (
                    <button
                      onClick={() => setActiveStep(2)}
                      style={{
                        ...primaryBtnStyle(false),
                        backgroundColor: '#16a34a',
                        marginLeft: 'auto',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803d'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16a34a'; }}
                    >
                      다음 단계 &rarr;
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ============================================================= */}
        {/* Step 2: 홈전산 키워드 등록                                      */}
        {/* ============================================================= */}
        {activeStep === 2 && (
          <section style={{ marginBottom: '24px' }}>
            <h2 style={sectionTitleStyle}>Step 2. 홈전산 키워드 등록</h2>
            {!setting ? (
              <div style={cardStyle}>
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 16px 0' }}>
                    솔루션 설정이 필요합니다. Step 1에서 먼저 설정을 저장해주세요.
                  </p>
                  <button
                    onClick={() => setActiveStep(1)}
                    style={primaryBtnStyle(false)}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#2563eb'; }}
                  >
                    Step 1로 이동
                  </button>
                </div>
              </div>
            ) : (
              <div style={cardStyle}>
                <p style={{ color: '#64748b', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
                  모집플레이스.com에 키워드를 등록합니다. 업체 정보가 자동으로 입력됩니다.
                </p>

                {/* Auto-filled company info */}
                <div style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  padding: '12px 16px',
                  marginBottom: '20px',
                  fontSize: '13px',
                  color: '#475569',
                }}>
                  <span style={{ fontWeight: 600 }}>업체명:</span> {company.companyName}
                  <span style={{ margin: '0 12px', color: '#cbd5e1' }}>|</span>
                  <span style={{ fontWeight: 600 }}>영업자:</span> {company.staffName || '-'}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                  {/* 플레이스 번호 */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>플레이스 번호 <span style={{ color: '#dc2626' }}>*</span></label>
                    <input
                      ref={hjPlaceIdRef}
                      type="text"
                      value={hjPlaceId}
                      onChange={(e) => {
                        setHjPlaceId(e.target.value);
                        if (validationErrors.hjPlaceId) setValidationErrors(prev => ({ ...prev, hjPlaceId: false }));
                      }}
                      placeholder="네이버 플레이스 고유번호"
                      style={{
                        ...inputStyle(false),
                        borderColor: validationErrors.hjPlaceId ? '#dc2626' : '#e2e8f0',
                      }}
                    />
                    {validationErrors.hjPlaceId && (
                      <span style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', display: 'block' }}>필수 항목입니다</span>
                    )}
                  </div>

                  {/* 키워드 */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>키워드 (콤마로 구분) <span style={{ color: '#dc2626' }}>*</span></label>
                    <input
                      ref={hjKeywordsRef}
                      type="text"
                      value={hjKeywords}
                      onChange={(e) => {
                        setHjKeywords(e.target.value);
                        if (validationErrors.hjKeywords) setValidationErrors(prev => ({ ...prev, hjKeywords: false }));
                      }}
                      placeholder="수원 음악학원, 수원 피아노"
                      style={{
                        ...inputStyle(false),
                        borderColor: validationErrors.hjKeywords ? '#dc2626' : '#e2e8f0',
                      }}
                    />
                    {validationErrors.hjKeywords && (
                      <span style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', display: 'block' }}>필수 항목입니다</span>
                    )}
                    <span style={hintStyle}>여러 키워드는 콤마(,)로 구분하여 입력</span>
                  </div>

                  {/* 카테고리 */}
                  <div>
                    <label style={labelStyle}>카테고리</label>
                    <select
                      value={hjCategory}
                      onChange={(e) => setHjCategory(e.target.value)}
                      style={{ ...inputStyle(false), cursor: 'pointer' }}
                    >
                      {HOMEJEONSAN_CATEGORIES.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  {/* 정상/선광고 */}
                  <div>
                    <label style={labelStyle}>광고 유형</label>
                    <select
                      value={hjAdType}
                      onChange={(e) => setHjAdType(e.target.value)}
                      style={{ ...inputStyle(false), cursor: 'pointer' }}
                    >
                      <option value="정상">정상</option>
                      <option value="선광고">선광고</option>
                    </select>
                  </div>
                </div>

                {/* Results */}
                {hjResults.length > 0 && (
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {hjResults.map((r, i) => (
                      <div key={i} style={{
                        padding: '8px 12px',
                        fontSize: '12px',
                        backgroundColor: r.success ? '#f0fdf4' : '#fef2f2',
                        border: r.success ? '1px solid #bbf7d0' : '1px solid #fecaca',
                        color: r.success ? '#16a34a' : '#dc2626',
                      }}>
                        [{r.keyword}] {r.success ? '등록 완료' : r.message}
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    onClick={() => setActiveStep(1)}
                    style={{
                      height: '36px',
                      padding: '0 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#475569',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    &larr; 이전
                  </button>
                  <button
                    disabled={hjSaving}
                    onClick={handleKeywordRegister}
                    style={primaryBtnStyle(hjSaving)}
                    onMouseEnter={(e) => { if (!hjSaving) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                    onMouseLeave={(e) => { if (!hjSaving) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                  >
                    {hjSaving ? '등록 중...' : '홈전산 등록'}
                  </button>
                  {hjMsg && (
                    <span style={{ fontSize: '13px', color: hjMsg.type === 'ok' ? '#16a34a' : '#dc2626' }}>
                      {hjMsg.text}
                    </span>
                  )}
                  <button
                    onClick={() => setActiveStep(3)}
                    style={{
                      ...primaryBtnStyle(false),
                      backgroundColor: '#16a34a',
                      marginLeft: 'auto',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803d'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16a34a'; }}
                  >
                    다음 단계 &rarr;
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ============================================================= */}
        {/* Step 3: 리포트 등록                                            */}
        {/* ============================================================= */}
        {activeStep === 3 && (
          <section style={{ marginBottom: '24px' }}>
            <h2 style={sectionTitleStyle}>Step 3. 리포트 등록</h2>
            {!setting ? (
              <div style={cardStyle}>
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 16px 0' }}>
                    솔루션 설정이 필요합니다. Step 1에서 먼저 설정을 저장해주세요.
                  </p>
                  <button
                    onClick={() => setActiveStep(1)}
                    style={primaryBtnStyle(false)}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#2563eb'; }}
                  >
                    Step 1로 이동
                  </button>
                </div>
              </div>
            ) : (
              <div style={cardStyle}>
                <p style={{ color: '#64748b', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>
                  모집플레이스.com에 리포트를 등록합니다. 계약 정보가 자동으로 반영됩니다.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px' }}>
                  {/* 플레이스 번호 */}
                  <div>
                    <label style={labelStyle}>플레이스 번호 <span style={{ color: '#dc2626' }}>*</span></label>
                    <input
                      ref={rpPlaceIdRef}
                      type="text"
                      value={rpPlaceId}
                      onChange={(e) => {
                        setRpPlaceId(e.target.value);
                        if (validationErrors.rpPlaceId) setValidationErrors(prev => ({ ...prev, rpPlaceId: false }));
                      }}
                      placeholder="네이버 플레이스 고유번호"
                      style={{
                        ...inputStyle(false),
                        borderColor: validationErrors.rpPlaceId ? '#dc2626' : '#e2e8f0',
                      }}
                    />
                    {validationErrors.rpPlaceId && (
                      <span style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', display: 'block' }}>필수 항목입니다</span>
                    )}
                  </div>

                  {/* 연락처 */}
                  <div>
                    <label style={labelStyle}>연락처 <span style={{ color: '#dc2626' }}>*</span></label>
                    <input
                      ref={rpPhoneRef}
                      type="text"
                      value={rpPhone}
                      onChange={(e) => {
                        setRpPhone(e.target.value);
                        if (validationErrors.rpPhone) setValidationErrors(prev => ({ ...prev, rpPhone: false }));
                      }}
                      placeholder="010-0000-0000"
                      style={{
                        ...inputStyle(false),
                        borderColor: validationErrors.rpPhone ? '#dc2626' : '#e2e8f0',
                      }}
                    />
                    {validationErrors.rpPhone && (
                      <span style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', display: 'block' }}>필수 항목입니다</span>
                    )}
                  </div>

                  {/* 계약시작일 */}
                  <div>
                    <label style={labelStyle}>계약시작일 <span style={{ color: '#dc2626' }}>*</span></label>
                    <input
                      ref={rpContractStartRef}
                      type="date"
                      value={rpContractStart}
                      onChange={(e) => {
                        setRpContractStart(e.target.value);
                        if (validationErrors.rpContractStart) setValidationErrors(prev => ({ ...prev, rpContractStart: false }));
                      }}
                      style={{
                        ...inputStyle(false),
                        borderColor: validationErrors.rpContractStart ? '#dc2626' : '#e2e8f0',
                      }}
                    />
                    {validationErrors.rpContractStart && (
                      <span style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px', display: 'block' }}>필수 항목입니다</span>
                    )}
                  </div>

                  {/* 계약개월수 */}
                  <div>
                    <label style={labelStyle}>계약개월수</label>
                    <select
                      value={rpMonths}
                      onChange={(e) => setRpMonths(parseInt(e.target.value))}
                      style={{ ...inputStyle(false), cursor: 'pointer' }}
                    >
                      {Array.from({ length: 24 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>{m}개월</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                  <button
                    onClick={() => setActiveStep(2)}
                    style={{
                      height: '36px',
                      padding: '0 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: '#475569',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    &larr; 이전
                  </button>
                  <button
                    disabled={rpSaving}
                    onClick={handleReportRegister}
                    style={primaryBtnStyle(rpSaving)}
                    onMouseEnter={(e) => { if (!rpSaving) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                    onMouseLeave={(e) => { if (!rpSaving) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                  >
                    {rpSaving ? '등록 중...' : '리포트 등록'}
                  </button>
                  {rpMsg && (
                    <span style={{ fontSize: '13px', color: rpMsg.type === 'ok' ? '#16a34a' : '#dc2626' }}>
                      {rpMsg.text}
                    </span>
                  )}
                  <button
                    onClick={() => setActiveStep(4)}
                    style={{
                      ...primaryBtnStyle(false),
                      backgroundColor: '#16a34a',
                      marginLeft: 'auto',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803d'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16a34a'; }}
                  >
                    다음 단계 &rarr;
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ============================================================= */}
        {/* Step 4: 진행 관리                                              */}
        {/* ============================================================= */}
        {activeStep === 4 && (
          <>
            {/* 솔루션 진행 */}
            <section style={{ marginBottom: '24px' }}>
              <h2 style={sectionTitleStyle}>Step 4. 진행 관리</h2>
              <div style={cardStyle}>
                {!setting ? (
                  <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                    솔루션 설정이 필요합니다. Step 1에서 먼저 설정해주세요.
                  </p>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {/* 블로그리뷰 */}
                      {setting.blogTarget > 0 && (
                        <ProgressCountItem
                          label="블로그리뷰"
                          count={progressForm.blogCount}
                          target={setting.blogTarget}
                          disabled={!canEditProgress}
                          onChange={(v) => setProgressForm({ ...progressForm, blogCount: v })}
                        />
                      )}

                      {/* 인스타 */}
                      {setting.instaTarget > 0 && (
                        <ProgressCountItem
                          label="인스타"
                          count={progressForm.instaCount}
                          target={setting.instaTarget}
                          disabled={!canEditProgress}
                          onChange={(v) => setProgressForm({ ...progressForm, instaCount: v })}
                        />
                      )}

                      {/* 홈페이지 */}
                      {setting.hasHomepage && (
                        <ProgressCheckItem
                          label="홈페이지"
                          checked={progressForm.homepageDone}
                          disabled={!canEditProgress}
                          onChange={(v) => setProgressForm({ ...progressForm, homepageDone: v })}
                        />
                      )}

                      {/* 영상제작 */}
                      {setting.videoType !== 'none' && (
                        <ProgressCheckItem
                          label={`영상제작 (${VIDEO_TYPES[setting.videoType]})`}
                          checked={progressForm.videoDone}
                          disabled={!canEditProgress}
                          onChange={(v) => setProgressForm({ ...progressForm, videoDone: v })}
                        />
                      )}

                      {/* Nothing applicable */}
                      {!setting.hasReward &&
                        setting.blogTarget === 0 &&
                        setting.instaTarget === 0 &&
                        !setting.hasHomepage &&
                        !setting.hasReport &&
                        !setting.hasSeo &&
                        setting.videoType === 'none' && (
                          <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                            해당하는 솔루션 항목이 없습니다.
                          </p>
                        )}
                    </div>

                    {/* Save button — admin/manager_team만 */}
                    {canEditProgress && (
                      <div className="flex items-center gap-3" style={{ marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                        <button
                          onClick={() => setActiveStep(3)}
                          style={{
                            height: '36px',
                            padding: '0 16px',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#475569',
                            backgroundColor: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                          }}
                        >
                          &larr; 이전
                        </button>
                        <button
                          disabled={progressSaving}
                          onClick={handleSaveProgress}
                          style={primaryBtnStyle(progressSaving)}
                          onMouseEnter={(e) => { if (!progressSaving) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                          onMouseLeave={(e) => { if (!progressSaving) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                        >
                          {progressSaving ? '저장 중...' : '진행 저장'}
                        </button>
                        {progressMsg && (
                          <span style={{ fontSize: '13px', color: progressMsg.type === 'ok' ? '#16a34a' : '#dc2626' }}>
                            {progressMsg.text}
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            {/* 메모 */}
            <section style={{ marginBottom: '24px' }}>
              <h2 style={sectionTitleStyle}>메모</h2>
              <div style={cardStyle}>
                {/* Write memo */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: memos.length > 0 ? '16px' : '0' }}>
                  <textarea
                    placeholder="메모를 입력하세요 (인수인계, 특이사항 등)"
                    value={memoText}
                    onChange={(e) => setMemoText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && memoText.trim()) {
                        e.preventDefault();
                        handleAddMemo();
                      }
                    }}
                    rows={2}
                    style={{ ...inputStyle(false), flex: 1, height: 'auto', padding: '8px 10px', resize: 'vertical' as const, whiteSpace: 'pre-wrap' as const }}
                  />
                  <button
                    disabled={memoSaving || !memoText.trim()}
                    onClick={handleAddMemo}
                    style={{
                      ...primaryBtnStyle(memoSaving || !memoText.trim()),
                      whiteSpace: 'nowrap' as const,
                    }}
                  >
                    {memoSaving ? '저장중...' : '등록'}
                  </button>
                </div>
                {/* Memo list */}
                {memos.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {memos.map((m) => (
                      <div key={m.id} style={{ padding: '10px 14px', backgroundColor: '#fafbfc', border: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: '13px', color: '#0f172a', margin: '0 0 4px 0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.content}</p>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>{m.user.displayName} · {formatDateTime(m.createdAt)}</span>
                        </div>
                        {(user?.userId === m.userId || user?.role === 'admin') && (
                          <button
                            onClick={() => handleDeleteMemo(m.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '12px', padding: '2px 4px', fontFamily: 'inherit' }}
                          >
                            삭제
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* 변경 이력 */}
            <section>
              <h2 style={sectionTitleStyle}>변경 이력</h2>
              <div style={cardStyle}>
                {logs.length === 0 ? (
                  <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>변경 이력이 없습니다.</p>
                ) : (
                  <>
                    {Array.from(groupLogsByDate(logs.slice(0, logLimit))).map(([date, entries]) => (
                      <div key={date} style={{ marginBottom: '16px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '8px', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>{date}</div>
                        {entries.map((log) => (
                          <div key={log.id} style={{ display: 'flex', gap: '12px', padding: '6px 0', fontSize: '13px' }}>
                            <div style={{ color: '#94a3b8', minWidth: '45px', fontSize: '12px' }}>
                              {new Date(log.createdAt).toTimeString().slice(0, 5)}
                            </div>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#2563eb', marginTop: '5px', flexShrink: 0 }} />
                            <div style={{ flex: 1, lineHeight: 1.6 }}>
                              <span style={{ color: '#475569', fontWeight: 500 }}>{log.user.displayName}</span>
                              <span style={{ color: '#94a3b8' }}>{' - '}{FIELD_LABELS[log.fieldName] ?? log.fieldName}{': '}</span>
                              <span style={{ color: '#dc2626', textDecoration: 'line-through' }}>{displayValue(log.fieldName, log.oldValue)}</span>
                              <span style={{ color: '#94a3b8' }}>{' → '}</span>
                              <span style={{ color: '#16a34a', fontWeight: 500 }}>{displayValue(log.fieldName, log.newValue)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                    {logs.length > logLimit && (
                      <div style={{ textAlign: 'center', paddingTop: '16px' }}>
                        <button
                          onClick={() => setLogLimit((prev) => prev + 50)}
                          style={{
                            padding: '6px 16px',
                            fontSize: '12px',
                            fontWeight: 500,
                            color: '#475569',
                            backgroundColor: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            transition: 'background-color 0.15s',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e2e8f0'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f1f5f9'; }}
                        >
                          더보기
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex" style={{ fontSize: '13px', lineHeight: 1.8 }}>
      <span style={{ width: '80px', flexShrink: 0, color: '#64748b', fontWeight: 500 }}>{label}</span>
      <span style={{ color: '#0f172a' }}>{value || '-'}</span>
    </div>
  );
}

function ToggleSwitch({
  value,
  disabled,
  onChange,
}: {
  value: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className="flex items-center gap-2"
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '22px',
          borderRadius: '11px',
          backgroundColor: value ? '#2563eb' : '#cbd5e1',
          position: 'relative',
          transition: 'background-color 0.2s',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <div
          style={{
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            position: 'absolute',
            top: '3px',
            left: value ? '21px' : '3px',
            transition: 'left 0.2s',
            boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
          }}
        />
      </div>
      <span style={{ fontSize: '13px', fontWeight: 500, color: value ? '#2563eb' : '#94a3b8' }}>
        {value ? 'O' : 'X'}
      </span>
    </button>
  );
}

function CheckboxField({
  checked,
  disabled,
  labelOn,
  labelOff,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  labelOn: string;
  labelOff: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex items-center gap-2.5"
      style={{ cursor: disabled ? 'default' : 'pointer' }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: '#2563eb', width: '16px', height: '16px' }}
      />
      <span
        style={{
          display: 'inline-block',
          fontSize: '12px',
          fontWeight: 600,
          padding: '2px 10px',
          backgroundColor: checked ? '#f0fdf4' : '#f1f5f9',
          color: checked ? '#16a34a' : '#94a3b8',
          border: checked ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
        }}
      >
        {checked ? labelOn : labelOff}
      </span>
      <span style={{ fontSize: '11px', color: '#94a3b8' }}>
        {checked ? '' : '(체크 시 해당)'}
      </span>
    </label>
  );
}

function ProgressCheckItem({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between" style={{ padding: '12px 16px', backgroundColor: '#fafbfc', border: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{label}</span>
      <div className="flex items-center gap-2">
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            padding: '2px 8px',
            backgroundColor: checked ? '#f0fdf4' : '#fef2f2',
            color: checked ? '#16a34a' : '#dc2626',
            border: checked ? '1px solid #bbf7d0' : '1px solid #fecaca',
          }}
        >
          {checked ? '완료' : '미완료'}
        </span>
        <label style={{ cursor: disabled ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            style={{ accentColor: '#2563eb', width: '16px', height: '16px' }}
          />
        </label>
      </div>
    </div>
  );
}

function ProgressCountItem({
  label,
  count,
  target,
  disabled,
  onChange,
}: {
  label: string;
  count: number;
  target: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const ratio = target > 0 ? Math.min(count / target, 1) : 0;
  const pct = Math.round(ratio * 100);
  const barColor = pct >= 100 ? '#16a34a' : pct >= 50 ? '#2563eb' : '#f59e0b';

  return (
    <div style={{ padding: '12px 16px', backgroundColor: '#fafbfc', border: '1px solid #f1f5f9' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{label}</span>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
            {count} / {target}건
          </span>
          <input
            type="number"
            min={0}
            max={target}
            disabled={disabled}
            value={count}
            onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
            style={{
              ...inputStyle(disabled),
              width: '72px',
              textAlign: 'center' as const,
            }}
          />
        </div>
      </div>
      {/* Progress bar */}
      <div style={{ height: '4px', backgroundColor: '#e2e8f0', width: '100%', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            backgroundColor: barColor,
            transition: 'width 0.3s, background-color 0.3s',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#0f172a',
  marginBottom: '10px',
  letterSpacing: '-0.01em',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  padding: '24px',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '12px',
  fontWeight: 600,
  color: '#475569',
  marginBottom: '6px',
  letterSpacing: '0.01em',
};

function inputStyle(disabled: boolean): React.CSSProperties {
  return {
    height: '36px',
    padding: '0 10px',
    fontSize: '13px',
    color: '#0f172a',
    backgroundColor: disabled ? '#f8fafc' : '#ffffff',
    border: '1px solid #e2e8f0',
    outline: 'none',
    width: '100%',
    fontFamily: 'inherit',
    opacity: disabled ? 0.7 : 1,
  };
}

const hintStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: '#94a3b8',
  marginTop: '4px',
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    height: '36px',
    padding: '0 20px',
    fontSize: '13px',
    fontWeight: 600,
    color: '#ffffff',
    backgroundColor: disabled ? '#93c5fd' : '#2563eb',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    letterSpacing: '-0.01em',
    transition: 'background-color 0.15s',
  };
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 600,
  color: '#475569',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  color: '#64748b',
  whiteSpace: 'nowrap',
};
