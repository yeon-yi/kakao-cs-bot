'use client';

import { useEffect, useState, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  holdingUntil: string | null;
  hasReward: boolean;
  blogTarget: number;
  instaTarget: number;
  hasHomepage: boolean;
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

interface ConsultationItem {
  id: number;
  userId: number;
  contactDate: string;
  contactType: string;
  content: string;
  nextContactDate: string | null;
  nextAction: string | null;
  user: { id: number; displayName: string };
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
  hasSeo: 'SEO',
  seoDone: 'SEO 완료',
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function calcProgress(setting: Setting | null, progress: Progress | null): { done: number; total: number; pct: number } {
  if (!setting || !progress) return { done: 0, total: 0, pct: 0 };
  let total = 0, done = 0;
  if (setting.blogTarget > 0) { total++; if (progress.blogCount >= setting.blogTarget) done++; }
  if (setting.instaTarget > 0) { total++; if (progress.instaCount >= setting.instaTarget) done++; }
  if (setting.hasHomepage) { total++; if (progress.homepageDone) done++; }
  if (setting.hasSeo) { total++; if (progress.seoDone) done++; }
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
  const booleanFields = ['isHolding', 'hasReward', 'hasHomepage', 'hasSeo', 'rewardDone', 'homepageDone', 'seoDone', 'videoDone',
    '홀딩', '리워드', '홈페이지', '리워드 완료', '홈페이지 완료', '영상 완료', 'SEO', 'SEO 완료'];
  if (booleanFields.includes(fieldName)) {
    if (value === 'true' || value === 'Y' || value === 'O') return 'O';
    if (value === 'false' || value === 'N' || value === 'X') return 'X';
  }
  if (['contractStart', 'contractEnd', '계약시작일', '계약종료일'].includes(fieldName)) {
    return toDateStr(value);
  }
  return value;
}

const CAN_EDIT_ROLES = ['admin', 'manager_team', 'branch_manager', 'manager', 'staff', 'renewal_director', 'renewal_chief', 'renewal_staff'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [setting, setSetting] = useState<Setting | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastBulkDates, setLastBulkDates] = useState<Record<string, string>>({});
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
    hasSeo: true,
    videoType: 'premium' as 'none' | 'premium' | 'short',
  });

  const [contractMonths, setContractMonths] = useState<number | ''>(12);

  // Progress form state
  const [progressForm, setProgressForm] = useState({
    rewardDone: false,
    blogCount: 0,
    instaCount: 0,
    homepageDone: false,
    seoDone: false,
    videoDone: false,
  });

  // PlaceId for Step 1
  const [settingPlaceId, setSettingPlaceId] = useState('');
  const [settingPlaceName, setSettingPlaceName] = useState('');
  const [placeIdChecking, setPlaceIdChecking] = useState(false);
  const [placeIdError, setPlaceIdError] = useState('');

  const [settingSaving, setSettingSaving] = useState(false);
  const [settingMsg, setSettingMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [progressSaving, setProgressSaving] = useState(false);
  const [progressMsg, setProgressMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [logPage, setLogPage] = useState(1);
  const LOG_PAGE_SIZE = 30;

  // -- 커스텀 확인 모달 --
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    type: 'info' | 'warning' | 'danger';
    confirmLabel?: string;
    resolve?: (v: boolean) => void;
  }>({ open: false, title: '', message: '', type: 'info' });

  const showConfirm = (title: string, message: string, type: 'info' | 'warning' | 'danger' = 'info', confirmLabel?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmModal({ open: true, title, message, type, confirmLabel, resolve });
    });
  };

  const closeConfirm = (result: boolean) => {
    confirmModal.resolve?.(result);
    setConfirmModal({ open: false, title: '', message: '', type: 'info' });
  };

  // -- 토스트 알림 --
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  function showToast(text: string, type: 'ok' | 'err' = 'ok') {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3000);
  }

  // -- 외부 링크 열기 (Electron에서 프로그램 내 새 창으로 열림) --
  function openExternal(url: string) {
    window.open(url, '_blank');
  }

  // Memos
  const [memos, setMemos] = useState<Memo[]>([]);
  const [memoText, setMemoText] = useState('');
  const [memoSaving, setMemoSaving] = useState(false);

  // Consultations
  const [consultations, setConsultations] = useState<ConsultationItem[]>([]);
  const [consultForm, setConsultForm] = useState({ contactDate: new Date().toISOString().slice(0, 10), contactType: 'phone', content: '', nextContactDate: '', nextAction: '' });
  const [consultSaving, setConsultSaving] = useState(false);
  const [editingConsultId, setEditingConsultId] = useState<number | null>(null);
  const [editConsultForm, setEditConsultForm] = useState({ content: '', contactType: '', nextContactDate: '', nextAction: '' });

  // Step 2: Homejeonsan keyword registration
  const [hjKeywords, setHjKeywords] = useState('');
  const [hjCategory, setHjCategory] = useState(HOMEJEONSAN_CATEGORIES[0]);
  const [hjAdType, setHjAdType] = useState('정상');
  const [hjPlaceId, setHjPlaceId] = useState('');
  const [hjSaving, setHjSaving] = useState(false);
  const [hjMsg, setHjMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [hjResults, setHjResults] = useState<Array<{ keyword: string; success: boolean; message: string }>>([]);
  const [hjDone, setHjDone] = useState(false);
  const [hjProgress, setHjProgress] = useState<{ current: number; total: number; currentKeyword: string } | null>(null);
  const [hjExistingKeywords, setHjExistingKeywords] = useState<Array<{ keyword: string; rank: string; staffName: string; date: string; adType: string }>>([]);

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
  const canEditProgress = user ? ['admin', 'manager_team', 'branch_manager', 'manager', 'staff', 'renewal_director', 'renewal_chief', 'renewal_staff'].includes(user.role) : false;
  const canDelete = user ? ['admin', 'manager_team', 'branch_manager', 'manager', 'renewal_director', 'renewal_chief'].includes(user.role) : false;

  // 리포트 통계 (모집플레이스 연동)
  const [reportStats, setReportStats] = useState<{
    blogCount: number; instaCount: number;
    lastBlogDate: string | null; lastInstaDate: string | null;
    reportUrl: string | null;
  } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  // 모집플레이스 URL 데이터 (홈페이지/영상/SEO)
  const [reportUrls, setReportUrls] = useState<{
    homepageUrl: string; promotionUrl: string;
    befLeftFileUrl: string; befRightFileUrl: string;
    aftLeftFileUrl: string; aftRightFileUrl: string;
  } | null>(null);
  // 블로그/인스타 개별 링크
  const [postLinks, setPostLinks] = useState<Array<{ type: 'blog' | 'insta'; url: string; date: string | null }>>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsLoaded, setPostsLoaded] = useState(false);
  const [postsExpanded, setPostsExpanded] = useState(false);

  // 업체 정보 수정
  const [editingCompany, setEditingCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({
    companyName: '', representative: '', phone: '', staffName: '', managerName: '', branch: '',
  });
  const [companySaving, setCompanySaving] = useState(false);

  // 솔루션 진행요청
  const [myRequests, setMyRequests] = useState<Array<{
    id: number; solutionType: string; status: string; isAS: boolean;
    reason: string | null; rejectionReason: string | null;
    resultCount: number | null; createdAt: string;
  }>>([]);
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  // 솔루션 진행요청 모달
  const [reqModal, setReqModal] = useState<{ open: boolean; type: string; label: string; isAS: boolean }>({ open: false, type: '', label: '', isAS: false });
  const [reqCheck1, setReqCheck1] = useState(false);
  const [reqCheck2, setReqCheck2] = useState(false);
  const [reqNote, setReqNote] = useState('');

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
      const data = await apiGet<CompanyDetailResponse & { lastBulkDates?: Record<string, string> }>(`/api/companies/${id}`);
      const c = data.company;
      setCompany(c);
      setSetting(c.setting);
      setProgress(c.progress);
      setLogs(c.logs ?? []);
      setLastBulkDates(data.lastBulkDates ?? {});
      if (c.placeId) {
        setSettingPlaceId(c.placeId);
      }
      setCompanyForm({
        companyName: c.companyName || '',
        representative: c.representative || '',
        phone: c.phone || '',
        staffName: c.staffName || '',
        managerName: c.managerName || '',
        branch: c.branch || '',
      });

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
          seoDone: c.progress.seoDone,
          videoDone: c.progress.videoDone,
        });
      }

      // 완료된 스텝 기준으로 다음 스텝 자동 이동
      if (c.setting && c.placeId) {
        setHjPlaceId(c.placeId);
        setRpPlaceId(c.placeId);
        // placeId 변경 시 완료 상태 초기화 후 재판정
        setHjDone(false);
        setRpDone(false);
        setHjExistingKeywords([]);
        setReportStats(null);
        // 홈전산에서 키워드/리포트 등록 여부 확인
        try {
          const searchRes = await fetch(`/api/homejeonsan?action=search_place&placeNumber=${encodeURIComponent(c.placeId)}`, { credentials: 'include' });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            // 기존 키워드 목록 저장
            if (searchData.keywords?.length > 0) {
              setHjExistingKeywords(searchData.keywords);
            }
            if (searchData.reportExists) {
              // Step 1~3 전부 완료 → Step 4 (진행 관리)
              setHjDone(true);
              setRpDone(true);
              setActiveStep(4);
            } else if (searchData.keywordCount > 0) {
              // Step 2까지 완료 → Step 3 (리포트)
              setHjDone(true);
              setActiveStep(3);
            } else {
              // placeId 있지만 키워드 미등록 → Step 2 (키워드)
              setActiveStep(2);
            }
          } else {
            // API 실패 시 placeId 있으므로 Step 2로
            setActiveStep(2);
          }
        } catch {
          // 조회 실패 시 placeId 있으므로 Step 2
          setActiveStep(2);
        }
      } else if (c.setting) {
        // 설정만 있고 placeId 없음 → Step 2 (키워드)
        setActiveStep(2);
      }
      // setting 없으면 Step 1 (기본값)
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
    } catch (e) { console.warn('[CompanyDetail] fetchMemos failed:', e); }
  }, [id]);

  const fetchConsultations = useCallback(async () => {
    try {
      const res = await apiGet<{ consultations: ConsultationItem[] }>(`/api/companies/${id}/consultations`);
      setConsultations(res.consultations ?? []);
    } catch (e) { console.warn('[CompanyDetail] fetchConsultations failed:', e); }
  }, [id]);

  useEffect(() => {
    fetchData();
    fetchMemos();
    fetchConsultations();
  }, [fetchData, fetchMemos, fetchConsultations]);

  // 솔루션 진행요청 조회
  const fetchMyRequests = useCallback(async () => {
    if (!company) return;
    try {
      const ym = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`/api/solution-requests?companyId=${company.id}&yearMonth=${ym}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setMyRequests((data.requests || []).map((r: Record<string, unknown>) => ({
          id: r.id, solutionType: r.solutionType, status: r.status, isAS: r.isAS,
          reason: r.reason, rejectionReason: r.rejectionReason,
          resultCount: r.resultCount, createdAt: r.createdAt,
        })));
      }
    } catch (e) { console.warn('[CompanyDetail] fetchMyRequests failed:', e); }
  }, [company]);
  useEffect(() => { fetchMyRequests(); }, [fetchMyRequests]);

  async function handleSolutionRequest(solutionType: string, isAS: boolean, reason?: string) {
    setRequestSubmitting(true);
    try {
      const res = await fetch('/api/solution-requests', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: company!.id, solutionType, isAS, reason }),
      });
      const data = await res.json();
      if (res.ok) { showToast(data.message, 'ok'); fetchMyRequests(); }
      else showToast(data.message, 'err');
    } catch { showToast('요청 실패', 'err'); }
    finally { setRequestSubmitting(false); }
  }

  // 리포트 통계 조회 (placeId 있는 업체만) + 진행 현황 자동 동기화
  useEffect(() => {
    if (!company?.placeId) return;
    setReportLoading(true);
    fetch(`/api/homejeonsan?action=report_stats&placeNumber=${encodeURIComponent(company.placeId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.exists) {
          const stats = {
            blogCount: data.blogCount || 0,
            instaCount: data.instaCount || 0,
            lastBlogDate: data.lastBlogDate || null,
            lastInstaDate: data.lastInstaDate || null,
            reportUrl: data.reportUrl || null,
          };
          setReportStats(stats);

          // 모집플레이스 건수가 있으면 항상 sync-progress API로 동기화
          if (stats.blogCount > 0 || stats.instaCount > 0) {
            fetch(`/api/companies/${id}/sync-progress`, {
              method: 'POST', credentials: 'include',
            }).then(r => r.ok ? r.json() : null).then(syncData => {
              if (syncData?.synced) {
                const sBlog = syncData.blogCount || 0;
                const sInsta = syncData.instaCount || 0;
                // setProgress(prev => ...) 패턴으로 stale closure 방지
                setProgress(prev => prev
                  ? { ...prev, blogCount: Math.max(prev.blogCount, sBlog), instaCount: Math.max(prev.instaCount, sInsta) }
                  : { id: 0, companyId: parseInt(id), rewardDone: false, blogCount: sBlog, instaCount: sInsta, homepageDone: false, seoDone: false, videoDone: false });
                setProgressForm(prev => ({
                  ...prev,
                  blogCount: Math.max(prev.blogCount, sBlog),
                  instaCount: Math.max(prev.instaCount, sInsta),
                }));
              }
            }).catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => setReportLoading(false));

    // URL 데이터도 함께 조회 (홈페이지/영상/SEO)
    fetch(`/api/homejeonsan?action=report_form_data&placeNumber=${encodeURIComponent(company.placeId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.reportId) {
          setReportUrls({
            homepageUrl: data.homepageUrl || '',
            promotionUrl: data.promotionUrl || '',
            befLeftFileUrl: data.befLeftFileUrl || '',
            befRightFileUrl: data.befRightFileUrl || '',
            aftLeftFileUrl: data.aftLeftFileUrl || '',
            aftRightFileUrl: data.aftRightFileUrl || '',
          });
          // URL이 있으면 자동으로 진행 상태 업데이트 (progress 유무 무관)
          if (data.homepageUrl) {
            setProgressForm(prev => prev.homepageDone ? prev : { ...prev, homepageDone: true });
          }
          if (data.promotionUrl) {
            setProgressForm(prev => prev.videoDone ? prev : { ...prev, videoDone: true });
          }
          if (data.befLeftFileUrl || data.aftLeftFileUrl) {
            setProgressForm(prev => prev.seoDone ? prev : { ...prev, seoDone: true });
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company?.placeId, id]);

  // Sync placeId between Step 2 and Step 3
  useEffect(() => {
    if (hjPlaceId) {
      setRpPlaceId(hjPlaceId);
    }
  }, [hjPlaceId]);

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

  // 네이버 플레이스 업장명 조회
  async function handlePlaceIdLookup() {
    const pid = settingPlaceId.trim();
    if (!pid) { setPlaceIdError('고유번호를 입력하세요.'); return; }
    if (!/^\d+$/.test(pid)) { setPlaceIdError('숫자만 입력 가능합니다.'); return; }

    setPlaceIdChecking(true);
    setPlaceIdError('');
    setSettingPlaceName('');
    try {
      const res = await fetch(`/api/naver-place?placeId=${encodeURIComponent(pid)}`, { credentials: 'include' });
      const data = await res.json();
      if (data.found) {
        setSettingPlaceName(data.name);
        setPlaceIdError('');
      } else {
        setPlaceIdError(data.message || '플레이스를 찾을 수 없습니다.');
        setSettingPlaceName('');
      }
    } catch {
      setPlaceIdError('조회 실패');
    } finally {
      setPlaceIdChecking(false);
    }
  }

  // Save settings
  async function handleSaveSetting() {
    // placeId 필수 검증
    const pid = settingPlaceId.trim();
    if (!pid) {
      setSettingMsg({ type: 'err', text: '플레이스 고유번호를 입력해주세요.' });
      return;
    }
    if (!/^\d+$/.test(pid)) {
      setSettingMsg({ type: 'err', text: '플레이스 고유번호는 숫자만 입력 가능합니다.' });
      return;
    }

    // 계약 기간 유효성 검증
    if (settingForm.contractStart && settingForm.contractEnd) {
      if (settingForm.contractEnd < settingForm.contractStart) {
        setSettingMsg({ type: 'err', text: '계약 종료일은 계약 시작일 이후여야 합니다.' });
        return;
      }
    }

    setSettingSaving(true);
    setSettingMsg(null);
    try {
      // 설정 저장
      await apiPost(`/api/companies/${id}/settings`, settingForm);
      // placeId도 함께 저장
      await fetch(`/api/companies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ placeId: pid }),
      });
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
    } catch (e) { console.warn('[CompanyDetail] handleAddMemo failed:', e); }
    finally { setMemoSaving(false); }
  }

  // Delete memo
  async function handleDeleteMemo(memoId: number) {
    if (!await showConfirm('메모 삭제', '메모를 삭제하시겠습니까?', 'danger', '삭제')) return;
    try {
      await fetch(`/api/companies/${id}/memos?memoId=${memoId}`, { method: 'DELETE', credentials: 'include' });
      await fetchMemos();
    } catch (e) { console.warn('[CompanyDetail] handleDeleteMemo failed:', e); }
  }

  // Add consultation
  async function handleAddConsultation() {
    if (!consultForm.content.trim()) return;
    setConsultSaving(true);
    try {
      await apiPost(`/api/companies/${id}/consultations`, {
        contactDate: consultForm.contactDate,
        contactType: consultForm.contactType,
        content: consultForm.content.trim(),
        nextContactDate: consultForm.nextContactDate || null,
        nextAction: consultForm.nextAction || null,
      });
      setConsultForm({ contactDate: new Date().toISOString().slice(0, 10), contactType: 'phone', content: '', nextContactDate: '', nextAction: '' });
      await fetchConsultations();
    } catch (e) { console.warn('[CompanyDetail] handleAddConsultation failed:', e); }
    finally { setConsultSaving(false); }
  }

  // Delete consultation
  async function handleDeleteConsultation(consultationId: number) {
    if (!await showConfirm('상담 삭제', '상담 이력을 삭제하시겠습니까?', 'danger', '삭제')) return;
    try {
      await fetch(`/api/companies/${id}/consultations?consultationId=${consultationId}`, { method: 'DELETE', credentials: 'include' });
      await fetchConsultations();
    } catch (e) { console.warn('[CompanyDetail] handleDeleteConsultation failed:', e); }
  }

  // Edit consultation
  function handleStartEditConsultation(c: ConsultationItem) {
    setEditingConsultId(c.id);
    setEditConsultForm({
      content: c.content,
      contactType: c.contactType,
      nextContactDate: c.nextContactDate ? c.nextContactDate.slice(0, 10) : '',
      nextAction: c.nextAction || '',
    });
  }

  async function handleSaveEditConsultation() {
    if (!editingConsultId) return;
    try {
      await fetch(`/api/companies/${id}/consultations`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultationId: editingConsultId,
          content: editConsultForm.content.trim(),
          contactType: editConsultForm.contactType,
          nextContactDate: editConsultForm.nextContactDate || null,
          nextAction: editConsultForm.nextAction || null,
        }),
      });
      setEditingConsultId(null);
      await fetchConsultations();
    } catch (e) { console.warn('[CompanyDetail] handleSaveEditConsultation failed:', e); }
  }

  // 블로그/인스타 개별 링크 조회
  async function fetchPostLinks() {
    if (!company?.placeId || postsLoaded || postsLoading) return;
    setPostsLoading(true);
    try {
      const res = await fetch(`/api/homejeonsan?action=fetch_posts&placeNumber=${company.placeId}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setPostLinks(data.posts || []);
        setPostsLoaded(true);
        setPostsExpanded(true);
      }
    } catch (e) { console.warn('[CompanyDetail] fetchPostLinks failed:', e); }
    finally { setPostsLoading(false); }
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

    setHjProgress({ current: 0, total: keywords.length, currentKeyword: keywords[0] });

    const results: Array<{ keyword: string; success: boolean; message: string }> = [];
    let successCount = 0;

    for (let i = 0; i < keywords.length; i++) {
      const keyword = keywords[i];
      setHjProgress({ current: i, total: keywords.length, currentKeyword: keyword });
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
        const data = await res.json();
        const kwResult = data.results?.[0];
        const success = kwResult?.success ?? data.success ?? false;
        const msg = kwResult?.message || data.error || data.message || '등록 실패';
        results.push({ keyword, success, message: msg });
        if (success) successCount++;
      } catch {
        results.push({ keyword, success: false, message: '서버 연결 실패' });
      }
      // 실시간 결과 업데이트
      setHjResults([...results]);
    }

    setHjProgress(null);
    const dupCount = results.filter(r => !r.success && (r.message.includes('중복') || r.message.includes('이미'))).length;
    const realFailCount = keywords.length - successCount - dupCount;

    if (realFailCount === 0) {
      // 전부 성공이거나 중복 건너뜀 → 완료 처리
      const parts = [];
      if (successCount > 0) parts.push(`${successCount}건 등록`);
      if (dupCount > 0) parts.push(`${dupCount}건 이미 등록됨`);
      setHjMsg({ type: 'ok', text: parts.join(', ') });
      setHjDone(true);
      if (hjPlaceId && company) {
        fetch(`/api/companies/${company.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ placeId: hjPlaceId }),
        }).catch((e) => { console.warn('[CompanyDetail] placeId patch failed:', e); });
      }
      setRpPlaceId(hjPlaceId);
    } else {
      setHjMsg({ type: 'err', text: `${successCount}건 성공, ${dupCount}건 중복, ${realFailCount}건 실패 (아래 상세 확인)` });
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
      } else if (result.error?.includes('이미') || result.error?.includes('존재') || result.message?.includes('이미') || result.message?.includes('존재')) {
        // 리포트가 이미 존재하는 경우 → 성공 처리
        setRpMsg({ type: 'ok', text: '리포트가 이미 등록되어 있습니다.' });
        setRpDone(true);
      } else {
        setRpMsg({ type: 'err', text: result.error || result.message || '리포트 등록 실패' });
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
    <>
    {/* 커스텀 확인 모달 */}
    {confirmModal.open && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* 오버레이 */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
          onClick={() => closeConfirm(false)} />
        {/* 모달 카드 */}
        <div style={{
          position: 'relative', width: '100%', maxWidth: '400px', margin: '0 16px',
          backgroundColor: '#fff', borderRadius: '12px', padding: '28px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          animation: 'fadeInUp 0.2s ease-out',
        }}>
          <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          {/* 아이콘 */}
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '48px', height: '48px', borderRadius: '50%',
              backgroundColor: confirmModal.type === 'danger' ? '#fef2f2' : confirmModal.type === 'warning' ? '#fffbeb' : '#eff6ff',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={confirmModal.type === 'danger' ? '#dc2626' : confirmModal.type === 'warning' ? '#d97706' : '#2563eb'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {confirmModal.type === 'danger' ? (
                  <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>
                ) : (
                  <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                )}
              </svg>
            </div>
          </div>
          {/* 제목 */}
          <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', textAlign: 'center', margin: '0 0 8px 0' }}>
            {confirmModal.title}
          </h3>
          {/* 메시지 */}
          <p style={{ fontSize: '14px', color: '#475569', textAlign: 'center', margin: '0 0 24px 0', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
            {confirmModal.message}
          </p>
          {/* 버튼 */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => closeConfirm(false)}
              style={{
                flex: 1, height: '42px', fontSize: '14px', fontWeight: 600,
                color: '#475569', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0',
                borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              취소
            </button>
            <button onClick={() => closeConfirm(true)}
              style={{
                flex: 1, height: '42px', fontSize: '14px', fontWeight: 600,
                color: '#fff',
                backgroundColor: confirmModal.type === 'danger' ? '#dc2626' : '#2563eb',
                border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {confirmModal.confirmLabel || '확인'}
            </button>
          </div>
        </div>
      </div>
    )}
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
            <select value={company.status || 'active'}
              onChange={async (e) => {
                const v = e.target.value;
                const labels: Record<string, string> = { active: '활성', completed: '완료', churned: '해지' };
                if (!await showConfirm('상태 변경', `상태를 "${labels[v]}"(으)로 변경하시겠습니까?`, 'warning')) { e.target.value = company.status || 'active'; return; }
                const res = await fetch(`/api/companies/${company.id}/status`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: v }) });
                if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.message || '상태 변경 실패', 'err'); e.target.value = company.status || 'active'; return; }
                fetchData();
              }}
              style={{ padding: '3px 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>
              <option value="active">활성</option>
              <option value="completed">완료</option>
              <option value="churned">해지</option>
            </select>
          )}
        </div>
      </header>

      <div style={{ padding: '24px 32px 48px', maxWidth: '960px' }}>
        {/* Section: 업체 정보 */}
        <section style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={sectionTitleStyle}>업체 정보</h2>
            {canEdit && !editingCompany && (
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setEditingCompany(true)}
                  style={{ padding: '4px 12px', fontSize: '12px', fontWeight: 500, color: '#2563eb', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  수정
                </button>
                {canDelete && (
                  <button onClick={async () => {
                    if (!await showConfirm('업체 삭제', `"${company.companyName}" 업체를 삭제하시겠습니까?\n\n관련 솔루션 설정, 메모, 상담 기록이 모두 삭제됩니다.`, 'danger', '삭제')) return;
                    try {
                      const res = await fetch(`/api/companies/${company.id}`, { method: 'DELETE', credentials: 'include' });
                      const data = await res.json();
                      if (res.ok) { showToast('삭제되었습니다.', 'ok'); router.push('/companies'); }
                      else showToast(data.message || '삭제 실패', 'err');
                    } catch { showToast('삭제 실패', 'err'); }
                  }}
                  style={{ padding: '4px 12px', fontSize: '12px', fontWeight: 500, color: '#dc2626', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    삭제
                  </button>
                )}
              </div>
            )}
          </div>
          <div style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', padding: '20px 24px' }}>
            {editingCompany ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 32px' }}>
                  {([
                    { key: 'companyName', label: '업체명' },
                    { key: 'representative', label: '대표자' },
                    { key: 'phone', label: '연락처' },
                    { key: 'staffName', label: '담당자' },
                    { key: 'managerName', label: '담당간부' },
                    { key: 'branch', label: '지사' },
                  ] as const).map(({ key, label }) => (
                    <div key={key} className="flex items-center" style={{ fontSize: '13px', lineHeight: 1.8 }}>
                      <span style={{ width: '80px', flexShrink: 0, color: '#64748b', fontWeight: 500 }}>{label}</span>
                      {key === 'branch' ? (
                        <select value={companyForm[key]} onChange={e => setCompanyForm({ ...companyForm, [key]: e.target.value })}
                          style={{ flex: 1, padding: '4px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px' }}>
                          <option value="">선택</option>
                          {['인천', '수원', '동탄', '용인', '부산', '본사'].map(b => <option key={b} value={b}>{b}</option>)}
                        </select>
                      ) : (
                        <input value={companyForm[key]} onChange={e => setCompanyForm({ ...companyForm, [key]: e.target.value })}
                          style={{ flex: 1, padding: '4px 8px', fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px' }} />
                      )}
                    </div>
                  ))}
                  <InfoRow label="등록자" value={company.registrant} />
                  <InfoRow label="결제일" value={toDateStr(company.paymentDate)} />
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                  <button onClick={() => setEditingCompany(false)} disabled={companySaving}
                    style={{ padding: '6px 16px', fontSize: '12px', fontWeight: 500, color: '#475569', backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    취소
                  </button>
                  <button disabled={companySaving} onClick={async () => {
                    if (!companyForm.companyName.trim() || !companyForm.representative.trim()) {
                      showToast('업체명과 대표자는 필수입니다.', 'err'); return;
                    }
                    setCompanySaving(true);
                    try {
                      const res = await fetch(`/api/companies/${company.id}`, {
                        method: 'PATCH', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(companyForm),
                      });
                      if (res.ok) { setEditingCompany(false); await fetchData(); }
                      else { const d = await res.json(); showToast(d.message || '수정 실패', 'err'); }
                    } catch { showToast('수정 실패', 'err'); }
                    finally { setCompanySaving(false); }
                  }}
                  style={{ padding: '6px 16px', fontSize: '12px', fontWeight: 600, color: '#fff', backgroundColor: '#2563eb', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit', opacity: companySaving ? 0.5 : 1 }}>
                    {companySaving ? '저장 중...' : '저장'}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 32px' }}>
                <InfoRow label="업체명" value={company.companyName} />
                <InfoRow label="대표자" value={company.representative} />
                <InfoRow label="연락처" value={company.phone} />
                <InfoRow label="등록자" value={company.registrant} />
                <InfoRow label="결제일" value={toDateStr(company.paymentDate)} />
                <InfoRow label="담당자" value={company.staffName} />
                <InfoRow label="담당간부" value={company.managerName} />
                {company.placeId && (
                  <div className="flex" style={{ fontSize: '13px', lineHeight: 1.8 }}>
                    <span style={{ width: '80px', flexShrink: 0, color: '#64748b', fontWeight: 500 }}>고유번호</span>
                    <span
                      style={{ color: '#2563eb', textDecoration: 'underline', cursor: 'pointer' }}
                      title="클릭하면 플레이스 페이지 열기"
                      onClick={() => openExternal(`https://m.place.naver.com/place/${company.placeId}/home`)}>
                      {company.placeId}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 홀딩 컨트롤 (영업자 포함 전 역할) */}
        {setting && (
          <div style={{
            backgroundColor: setting.isHolding ? '#fffbeb' : '#fff',
            border: `1px solid ${setting.isHolding ? '#fde68a' : '#e2e8f0'}`,
            borderLeft: setting.isHolding ? '3px solid #d97706' : undefined,
            padding: '14px 20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: setting.isHolding ? '#d97706' : '#0f172a' }}>
                {setting.isHolding ? '홀딩 중' : '정상 진행'}
              </span>
              {setting.isHolding && setting.holdingUntil && (
                <span style={{ fontSize: '12px', color: '#92400e', backgroundColor: '#fef3c7', padding: '2px 8px', borderRadius: '4px' }}>
                  {new Date(setting.holdingUntil as string).toISOString().split('T')[0]}까지
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {!setting.isHolding ? (
                <>
                  <input
                    type="date"
                    id="holdingUntilInput"
                    min={new Date().toISOString().split('T')[0]}
                    style={{ height: '32px', padding: '0 8px', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px' }}
                  />
                  <button onClick={async () => {
                    const dateInput = document.getElementById('holdingUntilInput') as HTMLInputElement;
                    const holdingUntil = dateInput?.value || null;
                    if (!await showConfirm('홀딩 설정', holdingUntil ? `${holdingUntil}까지 홀딩하시겠습니까?` : '기간 없이 홀딩하시겠습니까?\n(수동 해제 필요)', 'warning')) return;
                    const res = await fetch(`/api/companies/${company.id}/holding`, {
                      method: 'PATCH', credentials: 'include',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ isHolding: true, holdingUntil }),
                    });
                    if (res.ok) fetchData();
                    else showToast('홀딩 설정 실패', 'err');
                  }}
                  style={{ height: '32px', padding: '0 14px', fontSize: '12px', fontWeight: 600, color: '#fff', backgroundColor: '#d97706', border: 'none', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    홀딩 걸기
                  </button>
                </>
              ) : (
                <button onClick={async () => {
                  if (!await showConfirm('홀딩 해제', '홀딩을 해제하시겠습니까?', 'info')) return;
                  const res = await fetch(`/api/companies/${company.id}/holding`, {
                    method: 'PATCH', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isHolding: false }),
                  });
                  if (res.ok) fetchData();
                  else showToast('홀딩 해제 실패', 'err');
                }}
                style={{ height: '32px', padding: '0 14px', fontSize: '12px', fontWeight: 600, color: '#d97706', backgroundColor: '#fff', border: '1px solid #fde68a', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                  홀딩 해제
                </button>
              )}
            </div>
          </div>
        )}

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
                  onClick={async () => {
                    if (step.num !== 1 && !isStepComplete(step.num - 1)) return;
                    if (active) return; // 이미 해당 스텝
                    // 스텝 전환 확인 모달
                    if (step.num === 3 && !isStepComplete(2)) {
                      const ok = await showConfirm('키워드 등록 확인', '키워드 등록이 확인되었나요?\n홈전산에서 키워드가 정상 등록되었는지 확인 후 진행해주세요.', 'warning', '확인 완료');
                      if (!ok) return;
                    }
                    if (step.num === 4 && !isStepComplete(3)) {
                      const ok = await showConfirm('리포트 등록 확인', '리포트가 생성되었나요?\n모집플레이스에서 리포트가 정상 등록되었는지 확인 후 진행해주세요.', 'warning', '확인 완료');
                      if (!ok) return;
                    }
                    setActiveStep(step.num);
                  }}
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
                {/* 계약개월수 (날짜 위에 배치) */}
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

                {/* 계약기간 (날짜 지정) */}
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

                {/* 플레이스 고유번호 (필수) */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>플레이스 고유번호 <span style={{ color: '#dc2626' }}>*</span></label>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      type="text"
                      placeholder="숫자만 입력 (예: 1234567890)"
                      disabled={!canEdit}
                      value={settingPlaceId}
                      onChange={(e) => {
                        setSettingPlaceId(e.target.value.replace(/\D/g, ''));
                        setSettingPlaceName('');
                        setPlaceIdError('');
                      }}
                      style={{ ...inputStyle(!canEdit), width: '220px' }}
                    />
                    <button
                      type="button"
                      disabled={!canEdit || placeIdChecking || !settingPlaceId.trim()}
                      onClick={handlePlaceIdLookup}
                      style={{
                        height: '36px',
                        padding: '0 14px',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#fff',
                        backgroundColor: placeIdChecking || !settingPlaceId.trim() ? '#94a3b8' : '#0ea5e9',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: placeIdChecking || !settingPlaceId.trim() ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {placeIdChecking ? '조회중...' : '업장 확인'}
                    </button>
                    {settingPlaceName && (
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#16a34a', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12L2.5 8.5" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {settingPlaceName}
                      </span>
                    )}
                    {placeIdError && (
                      <span style={{ fontSize: '12px', color: '#dc2626' }}>{placeIdError}</span>
                    )}
                  </div>
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

                {/* SEO */}
                <div>
                  <label style={labelStyle}>SEO</label>
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
                    {/* 기존 등록된 키워드 표시 */}
                    {hjExistingKeywords.length > 0 && (
                      <div style={{ marginTop: '8px', padding: '10px 12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '12px' }}>
                        <div style={{ fontWeight: 600, color: '#16a34a', marginBottom: '6px' }}>
                          이미 등록된 키워드 ({hjExistingKeywords.length}건) — 추가 등록도 가능합니다
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {hjExistingKeywords.map((kw, i) => (
                            <span key={i} style={{
                              padding: '2px 8px', backgroundColor: '#fff', border: '1px solid #bbf7d0',
                              borderRadius: '3px', color: '#0f172a', fontSize: '11.5px',
                            }}>
                              {kw.keyword}
                              {kw.rank && kw.rank !== '순위없음' && <span style={{ color: '#2563eb', marginLeft: '4px', fontWeight: 600 }}>{kw.rank}위</span>}
                            </span>
                          ))}
                        </div>
                      </div>
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

                {/* Progress bar */}
                {hjProgress && (
                  <div style={{ marginTop: '16px', padding: '12px 16px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af' }}>
                        키워드 등록 중: {hjProgress.currentKeyword}
                      </span>
                      <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 600 }}>
                        {hjProgress.current + 1} / {hjProgress.total}
                      </span>
                    </div>
                    <div style={{ height: '6px', backgroundColor: '#dbeafe', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${((hjProgress.current + 1) / hjProgress.total) * 100}%`,
                        backgroundColor: '#2563eb',
                        borderRadius: '3px',
                        transition: 'width 0.3s ease',
                      }} />
                    </div>
                  </div>
                )}

                {/* Results */}
                {hjResults.length > 0 && (
                  <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {hjResults.map((r, i) => {
                      const isDup = !r.success && (r.message.includes('중복') || r.message.includes('이미'));
                      const bg = r.success ? '#f0fdf4' : isDup ? '#fffbeb' : '#fef2f2';
                      const border = r.success ? '1px solid #bbf7d0' : isDup ? '1px solid #fde68a' : '1px solid #fecaca';
                      const color = r.success ? '#16a34a' : isDup ? '#d97706' : '#dc2626';
                      const label = r.success ? '등록 완료' : isDup ? '이미 등록됨 (건너뜀)' : r.message;
                      return (
                        <div key={i} style={{ padding: '8px 12px', fontSize: '12px', backgroundColor: bg, border, color }}>
                          [{r.keyword}] {label}
                        </div>
                      );
                    })}
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
                  {hjMsg && (
                    <span style={{ fontSize: '13px', color: hjMsg.type === 'ok' ? '#16a34a' : '#dc2626' }}>
                      {hjMsg.text}
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                    <button
                      disabled={hjSaving}
                      onClick={handleKeywordRegister}
                      style={primaryBtnStyle(hjSaving)}
                      onMouseEnter={(e) => { if (!hjSaving) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                      onMouseLeave={(e) => { if (!hjSaving) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                    >
                      {hjSaving ? '등록 중...' : '홈전산 등록'}
                    </button>
                    <button
                      onClick={() => setActiveStep(3)}
                      style={{
                        ...primaryBtnStyle(false),
                        backgroundColor: '#16a34a',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803d'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16a34a'; }}
                    >
                      다음 단계 &rarr;
                    </button>
                  </div>
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
            ) : rpDone ? (
              <div style={cardStyle}>
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#f0fdf4', marginBottom: '12px' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="10" stroke="#16a34a" strokeWidth="2"/></svg>
                  </div>
                  <p style={{ fontSize: '14px', color: '#16a34a', fontWeight: 600, margin: '0 0 6px 0' }}>리포트가 이미 등록되어 있습니다.</p>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px 0' }}>Step 4에서 진행 현황을 관리할 수 있습니다.</p>
                  <button
                    onClick={() => setActiveStep(4)}
                    style={{
                      ...primaryBtnStyle(false),
                      backgroundColor: '#16a34a',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803d'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16a34a'; }}
                  >
                    Step 4로 이동 &rarr;
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
                  {rpMsg && (
                    <span style={{ fontSize: '13px', color: rpMsg.type === 'ok' ? '#16a34a' : '#dc2626' }}>
                      {rpMsg.text}
                    </span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                    <button
                      disabled={rpSaving}
                      onClick={handleReportRegister}
                      style={primaryBtnStyle(rpSaving)}
                      onMouseEnter={(e) => { if (!rpSaving) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                      onMouseLeave={(e) => { if (!rpSaving) e.currentTarget.style.backgroundColor = '#2563eb'; }}
                    >
                      {rpSaving ? '등록 중...' : '리포트 등록'}
                    </button>
                    <button
                      onClick={() => setActiveStep(4)}
                      style={{
                        ...primaryBtnStyle(false),
                        backgroundColor: '#16a34a',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#15803d'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#16a34a'; }}
                    >
                      다음 단계 &rarr;
                    </button>
                  </div>
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
                        <div>
                          <ProgressCountItem
                            label="블로그리뷰"
                            count={progressForm.blogCount}
                            target={setting.blogTarget}
                            disabled={!canEditProgress}
                            onChange={(v) => setProgressForm({ ...progressForm, blogCount: v })}
                          />
                          {lastBulkDates.blog && (
                            <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>
                              마지막 등록: {formatDateTime(lastBulkDates.blog)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* 인스타 */}
                      {setting.instaTarget > 0 && (
                        <div>
                          <ProgressCountItem
                            label="인스타"
                            count={progressForm.instaCount}
                            target={setting.instaTarget}
                            disabled={!canEditProgress}
                            onChange={(v) => setProgressForm({ ...progressForm, instaCount: v })}
                          />
                          {lastBulkDates.insta && (
                            <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>
                              마지막 등록: {formatDateTime(lastBulkDates.insta)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* 홈페이지 */}
                      {setting.hasHomepage && (
                        <div>
                          <ProgressCheckItem
                            label="홈페이지"
                            checked={progressForm.homepageDone}
                            disabled={!canEditProgress}
                            onChange={(v) => setProgressForm({ ...progressForm, homepageDone: v })}
                          />
                          {reportUrls?.homepageUrl && (
                            <span
                              style={{ fontSize: '11px', color: '#2563eb', marginLeft: '8px', textDecoration: 'underline', cursor: 'pointer', wordBreak: 'break-all' }}
                              onClick={() => openExternal(reportUrls.homepageUrl)}>
                              {reportUrls.homepageUrl.length > 40 ? reportUrls.homepageUrl.slice(0, 40) + '...' : reportUrls.homepageUrl}
                            </span>
                          )}
                          {lastBulkDates.homepage && (
                            <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>
                              마지막 등록: {formatDateTime(lastBulkDates.homepage)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* SEO */}
                      {setting.hasSeo && (
                        <div>
                          <ProgressCheckItem
                            label="SEO"
                            checked={progressForm.seoDone}
                            disabled={!canEditProgress}
                            onChange={(v) => setProgressForm({ ...progressForm, seoDone: v })}
                          />
                          {(reportUrls?.befLeftFileUrl || reportUrls?.aftLeftFileUrl) && (
                            <span style={{ fontSize: '11px', color: '#16a34a', marginLeft: '8px' }}>이미지 등록됨</span>
                          )}
                        </div>
                      )}

                      {/* 영상제작 */}
                      {setting.videoType !== 'none' && (
                        <div>
                          <ProgressCheckItem
                            label={`영상제작 (${VIDEO_TYPES[setting.videoType]})`}
                            checked={progressForm.videoDone}
                            disabled={!canEditProgress}
                            onChange={(v) => setProgressForm({ ...progressForm, videoDone: v })}
                          />
                          {reportUrls?.promotionUrl && (
                            <span
                              style={{ fontSize: '11px', color: '#2563eb', marginLeft: '8px', textDecoration: 'underline', cursor: 'pointer', wordBreak: 'break-all' }}
                              onClick={() => openExternal(reportUrls.promotionUrl)}>
                              {reportUrls.promotionUrl.length > 40 ? reportUrls.promotionUrl.slice(0, 40) + '...' : reportUrls.promotionUrl}
                            </span>
                          )}
                          {lastBulkDates.video && (
                            <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>
                              마지막 등록: {formatDateTime(lastBulkDates.video)}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Nothing applicable */}
                      {!setting.hasReward &&
                        setting.blogTarget === 0 &&
                        setting.instaTarget === 0 &&
                        !setting.hasHomepage &&
                        !setting.hasSeo &&
                        setting.videoType === 'none' && (
                          <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>
                            해당하는 솔루션 항목이 없습니다.
                          </p>
                        )}
                    </div>

                    {/* 모집플레이스 리포트 연동 */}
                    {company.placeId && (
                      <div style={{ marginTop: '20px', padding: '14px 16px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px' }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#15803d', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.5 4h1v1h-1V5zm0 2h1v4h-1V7z" fill="#16a34a"/></svg>
                          모집플레이스 리포트
                          {reportStats?.reportUrl && (
                            <span
                              style={{
                                marginLeft: 'auto', fontSize: '12px', fontWeight: 600,
                                color: '#2563eb', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
                                borderRadius: '4px', padding: '3px 10px', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                openExternal(reportStats!.reportUrl!);
                              }}
                            >
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M6 3H3v10h10v-3M9 2h5v5M14 2L7 9" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                              리포트 보기
                            </span>
                          )}
                        </div>
                        {reportLoading ? (
                          <span style={{ fontSize: '12px', color: '#64748b' }}>조회 중...</span>
                        ) : reportStats ? (
                          /* 리포트 등록됨 (블로그/인스타 건수가 0이어도 표시) */
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                            <div style={{ fontSize: '12px', color: '#334155' }}>
                              <span style={{ fontWeight: 500 }}>블로그</span>{' '}
                              <span style={{ fontWeight: 700, color: '#2563eb' }}>{reportStats.blogCount}건</span>
                              {reportStats.lastBlogDate && <span style={{ color: '#64748b', marginLeft: '4px' }}>최종 {reportStats.lastBlogDate}</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: '#334155' }}>
                              <span style={{ fontWeight: 500 }}>인스타</span>{' '}
                              <span style={{ fontWeight: 700, color: '#8b5cf6' }}>{reportStats.instaCount}건</span>
                              {reportStats.lastInstaDate && <span style={{ color: '#64748b', marginLeft: '4px' }}>최종 {reportStats.lastInstaDate}</span>}
                            </div>
                            {lastBulkDates.homepage && (
                              <div style={{ fontSize: '12px', color: '#334155' }}>
                                <span style={{ fontWeight: 500 }}>홈페이지</span>{' '}
                                <span style={{ color: '#64748b' }}>최종 {lastBulkDates.homepage.slice(0, 10)}</span>
                              </div>
                            )}
                            {lastBulkDates.video && (
                              <div style={{ fontSize: '12px', color: '#334155' }}>
                                <span style={{ fontWeight: 500 }}>영상</span>{' '}
                                <span style={{ color: '#64748b' }}>최종 {lastBulkDates.video.slice(0, 10)}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          lastBulkDates.homepage || lastBulkDates.video ? (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                              {lastBulkDates.homepage && <div style={{ fontSize: '12px' }}><span style={{ fontWeight: 500 }}>홈페이지</span> <span style={{ color: '#64748b' }}>최종 {lastBulkDates.homepage.slice(0, 10)}</span></div>}
                              {lastBulkDates.video && <div style={{ fontSize: '12px' }}><span style={{ fontWeight: 500 }}>영상</span> <span style={{ color: '#64748b' }}>최종 {lastBulkDates.video.slice(0, 10)}</span></div>}
                            </div>
                          ) : rpDone ? (
                            <span style={{ fontSize: '12px', color: '#2563eb' }}>리포트 등록 완료 (블로그/인스타 발행 대기)</span>
                          ) : <span style={{ fontSize: '12px', color: '#94a3b8' }}>리포트 데이터 없음</span>
                        )}
                      </div>
                    )}

                    {/* 블로그/인스타 개별 링크 */}
                    {company.placeId && (reportStats?.blogCount || reportStats?.instaCount) && (
                      <div style={{ marginTop: '16px', padding: '14px 16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                          onClick={() => {
                            if (!postsLoaded) fetchPostLinks();
                            else setPostsExpanded(!postsExpanded);
                          }}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"
                            style={{ transform: postsExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
                            <path d="M6 4l4 4-4 4" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>
                            발행 링크 목록
                          </span>
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            블로그 {reportStats?.blogCount || 0}건 / 인스타 {reportStats?.instaCount || 0}건
                          </span>
                          {postsLoading && <span style={{ fontSize: '11px', color: '#94a3b8' }}>조회 중...</span>}
                        </div>
                        {postsExpanded && postsLoaded && (
                          <div style={{ marginTop: '10px', maxHeight: '300px', overflowY: 'auto' }}>
                            {postLinks.length === 0 ? (
                              <span style={{ fontSize: '12px', color: '#94a3b8' }}>등록된 링크가 없습니다.</span>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                <thead>
                                  <tr>
                                    <th style={{ padding: '4px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 500, borderBottom: '1px solid #e2e8f0' }}>유형</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 500, borderBottom: '1px solid #e2e8f0' }}>URL</th>
                                    <th style={{ padding: '4px 8px', textAlign: 'right', color: '#94a3b8', fontWeight: 500, borderBottom: '1px solid #e2e8f0' }}>등록일</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {postLinks.map((p, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                                        <span style={{
                                          padding: '1px 6px', fontSize: '10px', fontWeight: 600, borderRadius: 3,
                                          backgroundColor: p.type === 'blog' ? '#eff6ff' : '#fdf4ff',
                                          color: p.type === 'blog' ? '#2563eb' : '#d946ef',
                                        }}>
                                          {p.type === 'blog' ? '블로그' : '인스타'}
                                        </span>
                                      </td>
                                      <td style={{ padding: '5px 8px', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                                          style={{ color: '#2563eb', textDecoration: 'none' }}
                                          title={p.url}>
                                          {p.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}{p.url.length > 80 ? '...' : ''}
                                        </a>
                                      </td>
                                      <td style={{ padding: '5px 8px', textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' }}>
                                        {p.date || '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 플레이스 스크린샷 (전/전전) */}
                    {company.placeId && (
                      <PlaceScreenshots placeId={company.placeId} canCapture={canEditProgress} showToast={showToast} />
                    )}

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

            {/* 솔루션 진행요청 */}
            {setting && (
              <section style={{ marginBottom: '24px' }}>
                <h2 style={sectionTitleStyle}>솔루션 진행요청</h2>
                <div style={cardStyle}>
                  <div style={{ fontSize: '12.5px', color: '#64748b', marginBottom: '12px' }}>
                    블로그/인스타: 월 1회 요청 | 홈페이지/SEO/영상: 최초 1회 요청
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: myRequests.length > 0 ? '16px' : '0' }}>
                    {[
                      { type: 'blog', label: '블로그', hasIt: setting.blogTarget > 0, monthly: true },
                      { type: 'insta', label: '인스타', hasIt: setting.instaTarget > 0, monthly: true },
                      { type: 'homepage', label: '홈페이지', hasIt: setting.hasHomepage, monthly: false },
                      { type: 'seo', label: 'SEO', hasIt: setting.hasSeo, monthly: false },
                      { type: 'video', label: '영상', hasIt: setting.videoType !== 'none', monthly: false },
                    ].map(({ type, label, hasIt, monthly }) => {
                      const existing = myRequests.find(r => r.solutionType === type && !r.isAS);
                      if (!hasIt) return null;
                      // 최초 1회 항목: 완료/접수/요청중이면 상태 표시만
                      if (!monthly && existing && (existing.status === 'completed' || existing.status === 'accepted' || existing.status === 'requested')) return (
                        <div key={type} style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #16a34a20', backgroundColor: '#16a34a08' }}>
                          <span style={{ fontWeight: 600 }}>{label}</span>{' '}
                          <span style={{ color: existing.status === 'completed' ? '#16a34a' : '#2563eb', fontWeight: 600 }}>
                            {existing.status === 'completed' ? '완료' : existing.status === 'accepted' ? '접수됨' : '요청중'}
                          </span>
                        </div>
                      );

                      // 반려된 경우: 반려 사유 표시 + 재요청 버튼
                      if (existing && existing.status === 'rejected') {
                        return (
                          <div key={type} style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fef2f2' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontWeight: 600 }}>{label}</span>
                              <span style={{ color: '#dc2626', fontWeight: 600 }}>반려</span>
                              <button disabled={requestSubmitting}
                                onClick={() => { setReqModal({ open: true, type, label, isAS: false }); setReqCheck1(false); setReqCheck2(false); setReqNote(''); }}
                                style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: '11px', fontWeight: 500, color: '#2563eb', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                                재요청
                              </button>
                            </div>
                            {existing.rejectionReason && (
                              <div style={{ fontSize: '11px', color: '#dc2626', marginTop: '4px' }}>반려사유: {existing.rejectionReason}</div>
                            )}
                          </div>
                        );
                      }

                      if (existing) {
                        const st = existing.status;
                        const stLabel = st === 'requested' ? '요청중' : st === 'accepted' ? '접수됨' : st === 'completed' ? '완료' : st === 'rejected' ? '반려' : st;
                        const stColor = st === 'requested' ? '#d97706' : st === 'accepted' ? '#2563eb' : st === 'completed' ? '#16a34a' : '#dc2626';
                        return (
                          <div key={type} style={{ padding: '8px 14px', fontSize: '13px', borderRadius: '6px', border: `1px solid ${stColor}20`, backgroundColor: `${stColor}08` }}>
                            <span style={{ fontWeight: 600 }}>{label}</span>{' '}
                            <span style={{ color: stColor, fontWeight: 600 }}>{stLabel}</span>
                            {existing.resultCount != null && <span style={{ marginLeft: '6px', color: '#2563eb' }}>({existing.resultCount}건)</span>}
                          </div>
                        );
                      }

                      return (
                        <button key={type} disabled={requestSubmitting}
                          onClick={() => { setReqModal({ open: true, type, label, isAS: false }); setReqCheck1(false); setReqCheck2(false); setReqNote(''); }}
                          style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, color: monthly ? '#2563eb' : '#059669', backgroundColor: monthly ? '#eff6ff' : '#f0fdf4', border: `1px solid ${monthly ? '#bfdbfe' : '#bbf7d0'}`, borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit' }}>
                          {label} {monthly ? '진행요청' : '요청 (1회)'}
                        </button>
                      );
                    })}
                  </div>

                  {/* AS 요청 */}
                  {myRequests.some(r => r.status === 'completed' || r.status === 'as_completed') && (
                    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', marginTop: '4px' }}>
                      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>완료된 솔루션에 대해 AS를 요청할 수 있습니다.</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {['blog', 'insta', 'homepage', 'seo', 'video'].map(type => {
                          const completed = myRequests.find(r => r.solutionType === type && (r.status === 'completed' || r.status === 'as_completed'));
                          const pendingAS = myRequests.find(r => r.solutionType === type && r.isAS && (r.status === 'as_requested' || r.status === 'as_accepted'));
                          if (!completed) return null;
                          const label = type === 'blog' ? '블로그' : type === 'insta' ? '인스타' : type === 'homepage' ? '홈페이지' : type === 'seo' ? 'SEO' : '영상';

                          if (pendingAS) {
                            const stLabel = pendingAS.status === 'as_requested' ? 'AS요청중' : 'AS접수';
                            return (
                              <span key={type} style={{ padding: '6px 12px', fontSize: '12px', color: '#7c3aed', backgroundColor: '#f5f3ff', borderRadius: '4px', border: '1px solid #ddd6fe' }}>
                                {label} {stLabel}
                              </span>
                            );
                          }

                          return (
                            <button key={type} disabled={requestSubmitting}
                              onClick={() => { setReqModal({ open: true, type, label, isAS: true }); setReqCheck1(false); setReqCheck2(false); setReqNote(''); }}
                              style={{ padding: '6px 12px', fontSize: '12px', fontWeight: 500, color: '#7c3aed', backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit' }}>
                              {label} AS요청
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 이번 달 요청 이력 */}
                  {myRequests.length > 0 && (
                    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', marginTop: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>이번 달 요청 이력</div>
                      {myRequests.map(r => {
                        const solLabels: Record<string, string> = { blog: '블로그', insta: '인스타', homepage: '홈페이지', seo: 'SEO', video: '영상' };
                        const solLabel = solLabels[r.solutionType] || r.solutionType;
                        const statusLabels: Record<string, string> = {
                          requested: '요청', accepted: '접수', completed: '완료', rejected: '반려',
                          as_requested: 'AS요청', as_accepted: 'AS접수', as_completed: 'AS완료',
                        };
                        const stLabel = statusLabels[r.status] || r.status;
                        const stColor = r.status.includes('reject') ? '#dc2626' : r.status.includes('complete') ? '#16a34a' : r.status.includes('accept') ? '#2563eb' : '#d97706';
                        return (
                          <div key={r.id} style={{ fontSize: '12px', color: '#475569', lineHeight: 1.8 }}>
                            {r.isAS ? '[AS] ' : ''}{solLabel} — <span style={{ color: stColor, fontWeight: 500 }}>{stLabel}</span>
                            {r.reason && r.status !== 'rejected' && <span style={{ color: '#94a3b8' }}> ({r.reason})</span>}
                            {r.rejectionReason && <span style={{ color: '#dc2626' }}> 반려사유: {r.rejectionReason}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            )}

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
                        {(user?.userId === m.userId || user?.role === 'admin' || user?.role === 'manager_team') && (
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

            {/* 상담 이력 */}
            <section style={{ marginBottom: '24px' }}>
              <h2 style={sectionTitleStyle}>상담 이력</h2>
              <div style={cardStyle}>
                {/* Write consultation */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: consultations.length > 0 ? '16px' : '0' }}>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      type="date"
                      value={consultForm.contactDate}
                      onChange={(e) => setConsultForm({ ...consultForm, contactDate: e.target.value })}
                      style={{ ...inputStyle(false), width: '150px' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {([{ value: 'phone', label: '전화' }, { value: 'visit', label: '방문' }, { value: 'kakao', label: '카카오톡' }] as const).map((t) => (
                        <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' }}>
                          <input type="radio" name="newConsultType" value={t.value} checked={consultForm.contactType === t.value}
                            onChange={() => setConsultForm({ ...consultForm, contactType: t.value })} style={{ accentColor: '#2563eb' }} />
                          {t.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <textarea
                    placeholder="상담 내용을 입력하세요..."
                    value={consultForm.content}
                    onChange={(e) => setConsultForm({ ...consultForm, content: e.target.value })}
                    rows={2}
                    style={{ ...inputStyle(false), height: 'auto', padding: '8px 10px', resize: 'vertical' as const }}
                  />
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>다음 연락일</span>
                      <input type="date" value={consultForm.nextContactDate} onChange={(e) => setConsultForm({ ...consultForm, nextContactDate: e.target.value })} style={{ ...inputStyle(false), width: '150px' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: '11px', color: '#94a3b8' }}>다음 조치사항</span>
                      <input value={consultForm.nextAction} onChange={(e) => setConsultForm({ ...consultForm, nextAction: e.target.value })} placeholder="다음 조치사항..." style={inputStyle(false)} />
                    </div>
                    <button
                      disabled={consultSaving || !consultForm.content.trim()}
                      onClick={handleAddConsultation}
                      style={{ ...primaryBtnStyle(consultSaving || !consultForm.content.trim()), whiteSpace: 'nowrap' as const }}
                    >
                      {consultSaving ? '저장중...' : '등록'}
                    </button>
                  </div>
                </div>
                {/* Consultation list */}
                {consultations.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {consultations.map((c) => {
                      const typeCfg = c.contactType === 'phone' ? { label: '전화', bg: '#dbeafe', color: '#2563eb' }
                        : c.contactType === 'visit' ? { label: '방문', bg: '#dcfce7', color: '#16a34a' }
                        : c.contactType === 'kakao' ? { label: '카카오톡', bg: '#fef9c3', color: '#a16207' }
                        : { label: c.contactType, bg: '#f1f5f9', color: '#64748b' };
                      const canModify = user?.userId === c.userId || user?.role === 'admin' || user?.role === 'manager_team';
                      const isEditing = editingConsultId === c.id;
                      return (
                        <div key={c.id} style={{ padding: '10px 14px', backgroundColor: '#fafbfc', border: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ background: typeCfg.bg, color: typeCfg.color, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600 }}>
                              {typeCfg.label}
                            </span>
                            <span style={{ fontSize: '12px', color: '#64748b' }}>{new Date(c.contactDate).toLocaleDateString('ko-KR')}</span>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{c.user.displayName}</span>
                            {canModify && !isEditing && (
                              <span style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                                <button onClick={() => handleStartEditConsultation(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '11px', padding: '2px 4px', fontFamily: 'inherit' }}>수정</button>
                                <button onClick={() => handleDeleteConsultation(c.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '11px', padding: '2px 4px', fontFamily: 'inherit' }}>삭제</button>
                              </span>
                            )}
                          </div>
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                {([{ value: 'phone', label: '전화' }, { value: 'visit', label: '방문' }, { value: 'kakao', label: '카카오톡' }] as const).map((t) => (
                                  <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer' }}>
                                    <input type="radio" name={`editType-${c.id}`} value={t.value} checked={editConsultForm.contactType === t.value}
                                      onChange={() => setEditConsultForm({ ...editConsultForm, contactType: t.value })} style={{ accentColor: '#2563eb' }} />
                                    {t.label}
                                  </label>
                                ))}
                              </div>
                              <textarea value={editConsultForm.content} onChange={(e) => setEditConsultForm({ ...editConsultForm, content: e.target.value })}
                                style={{ ...inputStyle(false), height: 'auto', padding: '8px 10px', resize: 'vertical' as const, minHeight: '60px' }} />
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <input type="date" value={editConsultForm.nextContactDate} onChange={(e) => setEditConsultForm({ ...editConsultForm, nextContactDate: e.target.value })}
                                  style={{ ...inputStyle(false), width: '150px' }} />
                                <input value={editConsultForm.nextAction} onChange={(e) => setEditConsultForm({ ...editConsultForm, nextAction: e.target.value })}
                                  placeholder="다음 조치사항" style={{ ...inputStyle(false), flex: 1 }} />
                              </div>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={handleSaveEditConsultation} style={{ ...primaryBtnStyle(false), height: '30px', padding: '0 14px', fontSize: '12px' }}>저장</button>
                                <button onClick={() => setEditingConsultId(null)} style={{ height: '30px', padding: '0 14px', fontSize: '12px', fontWeight: 600, color: '#64748b', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', cursor: 'pointer', fontFamily: 'inherit' }}>취소</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p style={{ fontSize: '13px', color: '#0f172a', margin: '0 0 4px 0', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.content}</p>
                              {(c.nextContactDate || c.nextAction) && (
                                <div style={{ marginTop: '6px', padding: '4px 8px', background: '#f0f4f8', borderRadius: '4px', fontSize: '11px', color: '#64748b' }}>
                                  {c.nextContactDate && <span>다음연락: {new Date(c.nextContactDate).toLocaleDateString('ko-KR')}</span>}
                                  {c.nextContactDate && c.nextAction && <span> · </span>}
                                  {c.nextAction && <span>조치: {c.nextAction}</span>}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* 솔루션 등록 이력 — 어떤 방식으로 몇 건이 반영됐는지 */}
            {setting && (
              <section style={{ marginBottom: '24px' }}>
                <h2 style={sectionTitleStyle}>솔루션 등록 이력</h2>
                <div style={cardStyle}>
                  <SolutionHistory companyId={company.id} />
                </div>
              </section>
            )}

            {/* 변경 이력 */}
            <section>
              <h2 style={sectionTitleStyle}>변경 이력</h2>
              <div style={cardStyle}>
                {logs.length === 0 ? (
                  <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>변경 이력이 없습니다.</p>
                ) : (() => {
                  const logTotalPages = Math.ceil(logs.length / LOG_PAGE_SIZE);
                  const pagedLogs = logs.slice((logPage - 1) * LOG_PAGE_SIZE, logPage * LOG_PAGE_SIZE);
                  return (
                    <>
                      {Array.from(groupLogsByDate(pagedLogs)).map(([date, entries]) => (
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
                      {logTotalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px', paddingTop: '16px', borderTop: '1px solid #f1f5f9' }}>
                          <button
                            disabled={logPage <= 1}
                            onClick={() => setLogPage(p => p - 1)}
                            style={{
                              height: '30px', padding: '0 10px', fontSize: '12px',
                              border: '1px solid #e2e8f0', borderRadius: '4px', backgroundColor: '#fff',
                              cursor: logPage <= 1 ? 'not-allowed' : 'pointer', opacity: logPage <= 1 ? 0.5 : 1,
                              fontFamily: 'inherit',
                            }}
                          >
                            이전
                          </button>
                          {Array.from({ length: logTotalPages }, (_, i) => i + 1)
                            .filter(p => p === 1 || p === logTotalPages || Math.abs(p - logPage) <= 2)
                            .reduce<(number | 'dots')[]>((acc, p, idx, arr) => {
                              if (idx > 0 && p - (arr[idx - 1]) > 1) acc.push('dots');
                              acc.push(p);
                              return acc;
                            }, [])
                            .map((p, idx) =>
                              p === 'dots' ? (
                                <span key={`dots-${idx}`} style={{ padding: '0 4px', fontSize: '12px', color: '#94a3b8' }}>...</span>
                              ) : (
                                <button
                                  key={p}
                                  onClick={() => setLogPage(p)}
                                  style={{
                                    height: '30px', minWidth: '30px', padding: '0 6px', fontSize: '12px',
                                    fontWeight: logPage === p ? 700 : 400,
                                    color: logPage === p ? '#fff' : '#475569',
                                    backgroundColor: logPage === p ? '#2563eb' : '#fff',
                                    border: logPage === p ? '1px solid #2563eb' : '1px solid #e2e8f0',
                                    borderRadius: '4px', cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {p}
                                </button>
                              )
                            )}
                          <button
                            disabled={logPage >= logTotalPages}
                            onClick={() => setLogPage(p => p + 1)}
                            style={{
                              height: '30px', padding: '0 10px', fontSize: '12px',
                              border: '1px solid #e2e8f0', borderRadius: '4px', backgroundColor: '#fff',
                              cursor: logPage >= logTotalPages ? 'not-allowed' : 'pointer', opacity: logPage >= logTotalPages ? 0.5 : 1,
                              fontFamily: 'inherit',
                            }}
                          >
                            다음
                          </button>
                          <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>
                            {logPage}/{logTotalPages} ({logs.length}건)
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </section>
          </>
        )}
      </div>
    </div>

    {/* ─── 솔루션 진행요청 모달 ─── */}
    {reqModal.open && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Backdrop */}
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(2px)' }}
          onClick={() => setReqModal({ ...reqModal, open: false })} />
        {/* Panel */}
        <div style={{
          position: 'relative', width: '420px', maxWidth: '90vw',
          backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          overflow: 'hidden', fontFamily: 'inherit',
        }}>
          {/* Header */}
          <div style={{
            padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                {reqModal.isAS ? `${reqModal.label} AS 요청` : `${reqModal.label} 진행요청`}
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                {company?.companyName}
              </p>
            </div>
            <button onClick={() => setReqModal({ ...reqModal, open: false })}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: '#f1f5f9', borderRadius: '6px', cursor: 'pointer', color: '#64748b', fontSize: '16px' }}>
              ✕
            </button>
          </div>
          {/* Body */}
          <div style={{ padding: '20px 24px' }}>
            {/* 확인 체크박스 2개 */}
            {!reqModal.isAS && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {[
                  { checked: reqCheck1, set: setReqCheck1, text: '작업에 필요한 자료(양식 및 사진)가 카카오톡 톡방에 전달된 부분을 확인했습니다.' },
                  { checked: reqCheck2, set: setReqCheck2, text: '당월 솔루션 작업이 리포트에 완료가 되지 않았음을 확인했습니다.' },
                ].map((item, idx) => (
                  <label key={idx} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '10px',
                    padding: '12px 14px', backgroundColor: item.checked ? '#f0fdf4' : '#fff',
                    border: `1px solid ${item.checked ? '#bbf7d0' : '#e2e8f0'}`, borderRadius: '8px',
                    cursor: 'pointer', transition: 'background-color 0.15s, border-color 0.15s',
                  }}>
                    <input type="checkbox" checked={item.checked}
                      onChange={(e) => item.set(e.target.checked)}
                      style={{ marginTop: '2px', width: '16px', height: '16px', accentColor: '#16a34a', cursor: 'pointer', flexShrink: 0 }} />
                    <span style={{ fontSize: '13px', fontWeight: 500, color: item.checked ? '#15803d' : '#334155', lineHeight: 1.5 }}>
                      {item.text}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {/* 특이사항 (필수) */}
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                {reqModal.isAS ? 'AS 사유' : '특이사항'} <span style={{ fontWeight: 600, color: '#dc2626' }}>(필수)</span>
              </label>
              <textarea
                value={reqNote}
                onChange={(e) => setReqNote(e.target.value)}
                placeholder={reqModal.isAS ? 'AS가 필요한 사유를 입력해주세요' : '관리팀에게 전달할 특이사항을 입력해주세요'}
                style={{
                  width: '100%', minHeight: '80px', padding: '10px 12px',
                  fontSize: '13px', color: '#0f172a', border: `1px solid ${reqNote.trim() ? '#e2e8f0' : '#fca5a5'}`,
                  borderRadius: '6px', resize: 'vertical', fontFamily: 'inherit',
                  outline: 'none', boxSizing: 'border-box', lineHeight: 1.5,
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#2563eb'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = reqNote.trim() ? '#e2e8f0' : '#fca5a5'; }}
              />
            </div>
          </div>
          {/* Footer */}
          {(() => {
            const allChecked = reqModal.isAS || (reqCheck1 && reqCheck2);
            const hasNote = !!reqNote.trim();
            const canSubmit = allChecked && hasNote && !requestSubmitting;
            return (
              <div style={{
                padding: '16px 24px', borderTop: '1px solid #f1f5f9',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {!allChecked && !reqModal.isAS && '위 항목을 모두 체크해주세요'}
                  {allChecked && !hasNote && '특이사항을 입력해주세요'}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setReqModal({ ...reqModal, open: false })}
                    style={{ height: '36px', padding: '0 16px', fontSize: '13px', fontWeight: 500, color: '#475569', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    취소
                  </button>
                  <button
                    disabled={!canSubmit}
                    onClick={async () => {
                      const reason = reqNote.trim() || undefined;
                      setReqModal({ ...reqModal, open: false });
                      await handleSolutionRequest(reqModal.type, reqModal.isAS, reason);
                    }}
                    style={{
                      height: '36px', padding: '0 20px', fontSize: '13px', fontWeight: 600,
                      color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
                      backgroundColor: canSubmit ? (reqModal.isAS ? '#7c3aed' : '#2563eb') : '#94a3b8',
                      transition: 'background-color 0.15s',
                    }}>
                    {requestSubmitting ? '요청 중...' : reqModal.isAS ? 'AS 요청' : '진행요청'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    )}
    {/* (외부 링크는 Electron이 프로그램 내 새 창으로 처리) */}
    {/* 토스트 알림 */}
    {toast && (
      <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 60, padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 600, color: '#fff', backgroundColor: toast.type === 'ok' ? '#16a34a' : '#dc2626', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'fadeInUp 0.3s ease' }}>
        {toast.text}
      </div>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------
// SolutionHistory — 솔루션 등록 이력 (수동/일괄/진행요청/리포트 자동)
// ---------------------------------------------------------------------------

function SolutionHistory({ companyId }: { companyId: number }) {
  const [logs, setLogs] = useState<Array<{
    source: string; type: string; count: number | null; done: boolean | null;
    date: string; actor: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch_() {
      try {
        // 1. 일괄등록 이력 (SolutionBulkLog)
        const bulkRes = await fetch(`/api/solutions/bulk?action=history&page=1&pageSize=50`, { credentials: 'include' });
        const bulkData = bulkRes.ok ? await bulkRes.json() : { logs: [] };

        const entries: typeof logs = [];

        for (const log of bulkData.logs || []) {
          if (log.rolledBack) continue;
          try {
            const details = JSON.parse(log.details);
            for (const d of details) {
              if (d.companyId !== companyId || d.status !== 'success') continue;
              if (Number(d.blogCount) > 0) entries.push({ source: '일괄등록', type: '블로그', count: d.blogCount, done: null, date: log.createdAt, actor: log.user?.displayName || '' });
              if (Number(d.instaCount) > 0) entries.push({ source: '일괄등록', type: '인스타', count: d.instaCount, done: null, date: log.createdAt, actor: log.user?.displayName || '' });
              if (d.homepageDone === true) entries.push({ source: '일괄등록', type: '홈페이지', count: null, done: true, date: log.createdAt, actor: log.user?.displayName || '' });
              if (d.videoDone === true) entries.push({ source: '일괄등록', type: '영상', count: null, done: true, date: log.createdAt, actor: log.user?.displayName || '' });
            }
          } catch { /* JSON parse 실패 시 해당 로그 건너뜀 */ }
        }

        // 2. 진행요청 이력 (SolutionRequest)
        const reqRes = await fetch(`/api/solution-requests?companyId=${companyId}`, { credentials: 'include' });
        const reqData = reqRes.ok ? await reqRes.json() : { requests: [] };
        for (const r of reqData.requests || []) {
          if (r.status !== 'completed' && r.status !== 'as_completed') continue;
          const typeLabel = r.solutionType === 'blog' ? '블로그' : r.solutionType === 'insta' ? '인스타' : r.solutionType === 'homepage' ? '홈페이지' : r.solutionType === 'video' ? '영상' : r.solutionType === 'seo' ? 'SEO' : r.solutionType;
          entries.push({
            source: r.isAS ? 'AS완료' : '진행요청',
            type: typeLabel,
            count: r.resultCount,
            done: r.resultDone,
            date: r.completedAt || r.updatedAt,
            actor: r.assignedTo?.displayName || '',
          });
        }

        // 3. 리포트 자동 (progress.updatedAt 기반 — 별도 로그는 없지만 표시)
        // 리포트 데이터가 있으면 표시
        try {
          const reportRes = await fetch(`/api/homejeonsan?action=report_stats&placeNumber=${companyId}`, { credentials: 'include' });
          // report_stats는 placeId 필요 — companyId 아님. 여기서는 스킵.
        } catch { /* 의도적 스킵 */ }

        entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setLogs(entries);
      } catch (e) { console.warn('[SolutionHistory] load failed:', e); }
      finally { setLoading(false); }
    }
    fetch_();
  }, [companyId]);

  if (loading) return <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>로딩 중...</p>;
  if (logs.length === 0) return <p style={{ fontSize: '13px', color: '#94a3b8', margin: 0 }}>등록 이력이 없습니다.</p>;

  const sourceColors: Record<string, { color: string; bg: string }> = {
    '일괄등록': { color: '#2563eb', bg: '#eff6ff' },
    '진행요청': { color: '#16a34a', bg: '#f0fdf4' },
    'AS완료': { color: '#7c3aed', bg: '#f5f3ff' },
    '수동': { color: '#475569', bg: '#f1f5f9' },
    '리포트': { color: '#d97706', bg: '#fffbeb' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {logs.map((l, i) => {
        const sc = sourceColors[l.source] || sourceColors['수동'];
        const dateStr = new Date(l.date).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) + ' ' + new Date(l.date).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', lineHeight: 1.6 }}>
            <span style={{ padding: '1px 8px', borderRadius: '4px', fontWeight: 600, fontSize: '11px', color: sc.color, backgroundColor: sc.bg, flexShrink: 0 }}>
              {l.source}
            </span>
            <span style={{ fontWeight: 500, color: '#0f172a' }}>{l.type}</span>
            {l.count != null && <span style={{ color: '#2563eb', fontWeight: 600 }}>+{l.count}건</span>}
            {l.done && <span style={{ color: '#16a34a', fontWeight: 600 }}>완료</span>}
            <span style={{ color: '#94a3b8', marginLeft: 'auto', flexShrink: 0 }}>{dateStr} {l.actor && `· ${l.actor}`}</span>
          </div>
        );
      })}
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

// ---------------------------------------------------------------------------
// PlaceScreenshots — 플레이스 전/전전 스크린샷 미리보기 + 다운로드
// ---------------------------------------------------------------------------

function PlaceScreenshots({ placeId, canCapture = false, showToast }: { placeId: string; canCapture?: boolean; showToast?: (text: string, type: 'ok' | 'err') => void }) {
  const [status, setStatus] = useState<{ before1: boolean; before2: boolean; after1: boolean; after2: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturingBefore, setCapturingBefore] = useState(false);
  const [capturingAfter, setCapturingAfter] = useState(false);

  function reload() {
    fetch(`/api/screenshots?placeId=${encodeURIComponent(placeId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStatus({ before1: !!d.before1, before2: !!d.before2, after1: !!d.after1, after2: !!d.after2 }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, [placeId]);

  async function handleCapture(mode: 'before' | 'after') {
    const setCapturing = mode === 'before' ? setCapturingBefore : setCapturingAfter;
    setCapturing(true);
    try {
      const modeParam = mode === 'after' ? '&mode=after' : '';
      const res = await fetch(`/api/screenshots?placeId=${encodeURIComponent(placeId)}${modeParam}`, { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        reload();
      } else {
        showToast?.(data.error || '캡처 실패', 'err');
      }
    } catch { showToast?.('캡처 요청 실패', 'err'); }
    finally { setCapturing(false); }
  }

  if (loading) return null;

  const hasBefore = status?.before1 || status?.before2;
  const hasAfter = status?.after1 || status?.after2;

  const renderSection = (label: string, types: Array<{ type: string; label: string; exists: boolean }>, mode: 'before' | 'after', capturing: boolean) => (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: mode === 'before' ? '#475569' : '#059669', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        {label}
        {canCapture && (
          <button
            onClick={() => handleCapture(mode)}
            disabled={capturing}
            style={{
              marginLeft: 'auto', fontSize: '11px', fontWeight: 600,
              color: capturing ? '#94a3b8' : mode === 'before' ? '#2563eb' : '#059669',
              backgroundColor: '#fff',
              border: `1px solid ${mode === 'before' ? '#bfdbfe' : '#bbf7d0'}`,
              borderRadius: '4px', padding: '2px 8px',
              cursor: capturing ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {capturing ? '캡처 중...' : types.some(t => t.exists) ? '다시 캡처' : '캡처'}
          </button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {types.map(t => {
          const imgUrl = `/api/screenshots?placeId=${encodeURIComponent(placeId)}&type=${encodeURIComponent(t.type)}`;
          return (
            <div key={t.type} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: 500, color: '#64748b', marginBottom: '4px' }}>{t.label}</div>
              {t.exists ? (
                <>
                  <img src={imgUrl} alt={t.label} style={{ width: '100%', maxHeight: '250px', objectFit: 'contain', borderRadius: '4px', border: '1px solid #e2e8f0', backgroundColor: '#fff' }} />
                  <a href={imgUrl} download={`${placeId}_${t.type}.png`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', marginTop: '4px', fontSize: '10px', color: '#2563eb', textDecoration: 'underline' }}>다운로드</a>
                </>
              ) : (
                <div style={{ padding: '16px', color: '#94a3b8', fontSize: '11px', backgroundColor: '#fff', borderRadius: '4px', border: '1px dashed #e2e8f0' }}>미캡처</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: '20px', padding: '14px 16px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#475569', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="#475569" strokeWidth="1.3"/><circle cx="6" cy="7" r="1.5" stroke="#475569" strokeWidth="1"/><path d="M2 11l3-3 2 2 3-4 4 5" stroke="#475569" strokeWidth="1" strokeLinejoin="round"/></svg>
        플레이스 스크린샷 (SEO 전후 비교)
      </div>
      {renderSection('전 (SEO 작업 전)', [
        { type: '전', label: '전 - 홈탭', exists: !!status?.before1 },
        { type: '전전', label: '전전 - 정보탭', exists: !!status?.before2 },
      ], 'before', capturingBefore)}
      {renderSection('후 (SEO 작업 후)', [
        { type: '후', label: '후 - 홈탭', exists: !!status?.after1 },
        { type: '후후', label: '후후 - 정보탭', exists: !!status?.after2 },
      ], 'after', capturingAfter)}
      {!hasBefore && !hasAfter && (
        <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '8px 0' }}>
          스크린샷이 없습니다. 위 &quot;캡처&quot; 버튼을 눌러 촬영하세요.
        </div>
      )}
    </div>
  );
}
