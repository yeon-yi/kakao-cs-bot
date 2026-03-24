'use client';

import { useEffect, useState, useCallback, use } from 'react';
import Link from 'next/link';
import { apiGet, apiPost, apiDelete } from '@/lib/api-client';

interface Company {
  id: number;
  companyName: string;
  representative: string;
  phone: string;
  branch: string | null;
  paymentDate: string;
  staffName: string;
  managerName: string;
  cardCompany: string | null;
  paymentAmount: number | null;
  upsellAssignments: Assignment[];
}

interface Assignment {
  id: number;
  isExcluded: boolean;
  assignedTo: { id: number; displayName: string };
  product: Product | null;
}

interface Product {
  id: number;
  hasPowerlink: boolean;
  powerlinkAdId: string | null;
  powerlinkAdPassword: string | null;
  powerlinkDone: boolean;
  reviewType: string;
  receiptReviewTarget: number;
  kakaoReviewTarget: number;
  totalReviewTarget: number;
  receiptReviewCount: number;
  kakaoReviewCount: number;
  channelType: string;
  channelDone: boolean;
  upsellAmount: number | null;
  kakaoMapUrl: string | null;
  kakaoMapPlaceId: string | null;
  kakaoMapName: string | null;
  initialReviewCount: number;
  exposureCount: number;
  contractStart: string | null;
  contractEnd: string | null;
  // 결제 관리
  paymentStatus: string;
  paymentMethod: string | null;
  paymentCardType: string | null;
  paymentCardCompany: string | null;
  paymentCashAmount: number | null;
  paymentCardAmount: number | null;
  hasTaxInvoice: boolean;
  paymentNote: string | null;
  paidAt: string | null;
}

interface Review {
  id: number;
  author: string;
  title: string;
  content: string;
  rating: number;
  isOurs: boolean;
  isManual: boolean;
  confirmedAt: string | null;
  confirmedBy: { displayName: string } | null;
  fetchedAt: string;
}

interface KakaoPlace {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  url: string;
}

const TABS = ['기본정보', '상품설정', '결제관리', '카카오맵 리뷰', '상담이력', '활동내역'] as const;
type Tab = typeof TABS[number];

export default function UpsellCompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [company, setCompany] = useState<Company | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [logs, setLogs] = useState<Array<{ id: number; action: string; details: string | null; createdAt: string; user: { displayName: string } }>>([]);
  const [tab, setTab] = useState<Tab>('기본정보');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authRole, setAuthRole] = useState('');
  const [authUserId, setAuthUserId] = useState<number | null>(null);

  // 업체 정보 수정 상태
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({ companyName: '', representative: '', phone: '', staffName: '', managerName: '' });

  // 상품 폼 상태
  const [form, setForm] = useState({
    hasPowerlink: false, powerlinkAdId: '', powerlinkAdPassword: '', powerlinkDone: false,
    reviewType: 'both', receiptReviewTarget: 75, kakaoReviewTarget: 75, totalReviewTarget: 150,
    receiptReviewCount: 0, kakaoReviewCount: 0,
    channelType: 'none', channelDone: false, upsellAmount: '',
    kakaoMapUrl: '', kakaoMapPlaceId: '', kakaoMapName: '',
    contractStart: '', contractEnd: '',
  });

  // 카카오맵 검색
  const [kakaoSearch, setKakaoSearch] = useState('');
  const [kakaoResults, setKakaoResults] = useState<KakaoPlace[]>([]);
  const [kakaoSearching, setKakaoSearching] = useState(false);

  // 리뷰 체크
  const [selectedReviews, setSelectedReviews] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  // 수동 리뷰 추가
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualReview, setManualReview] = useState({ author: '', content: '', rating: 5 });

  // 결제 관리 상태
  const [paymentForm, setPaymentForm] = useState({
    paymentStatus: 'unpaid',
    paymentMethod: '' as string,
    paymentCardType: '' as string,
    paymentCardCompany: '' as string,
    paymentCashAmount: '' as string,
    paymentCardAmount: '' as string,
    hasTaxInvoice: false,
    paymentNote: '' as string,
  });
  const [savingPayment, setSavingPayment] = useState(false);

  // 메모(특이사항)
  const [memos, setMemos] = useState<Array<{ id: number; content: string; createdAt: string; user: { displayName: string } }>>([]);
  const [newMemo, setNewMemo] = useState('');

  // 상담이력
  const [consultations, setConsultations] = useState<Array<{id:number; contactDate:string; contactType:string; content:string; nextContactDate:string|null; nextAction:string|null; user:{displayName:string}}>>([]);
  const [consultForm, setConsultForm] = useState({ contactDate: new Date().toISOString().slice(0,10), contactType: 'phone', content: '', nextContactDate: '', nextAction: '' });
  const [consultSaving, setConsultSaving] = useState(false);

  const loadCompany = useCallback(async () => {
    try {
      const data = await apiGet<{ company: Company }>(`/api/upsell/companies/${id}`);
      const comp = data.company;
      setCompany(comp);
      // 상품 폼 초기화
      const product = comp.upsellAssignments?.[0]?.product;
      if (product) {
        setForm({
          hasPowerlink: product.hasPowerlink,
          powerlinkAdId: product.powerlinkAdId || '',
          powerlinkAdPassword: product.powerlinkAdPassword || '',
          powerlinkDone: product.powerlinkDone,
          reviewType: product.reviewType,
          receiptReviewTarget: product.receiptReviewTarget,
          kakaoReviewTarget: product.kakaoReviewTarget,
          totalReviewTarget: product.totalReviewTarget,
          receiptReviewCount: product.receiptReviewCount,
          kakaoReviewCount: product.kakaoReviewCount,
          channelType: product.channelType,
          channelDone: product.channelDone,
          upsellAmount: product.upsellAmount?.toString() || '',
          kakaoMapUrl: product.kakaoMapUrl || '',
          kakaoMapPlaceId: product.kakaoMapPlaceId || '',
          kakaoMapName: product.kakaoMapName || '',
          contractStart: product.contractStart?.slice(0, 10) || '',
          contractEnd: product.contractEnd?.slice(0, 10) || '',
        });
        // 결제 폼 초기화
        setPaymentForm({
          paymentStatus: product.paymentStatus || 'unpaid',
          paymentMethod: product.paymentMethod || '',
          paymentCardType: product.paymentCardType || '',
          paymentCardCompany: product.paymentCardCompany || '',
          paymentCashAmount: product.paymentCashAmount?.toString() || '',
          paymentCardAmount: product.paymentCardAmount?.toString() || '',
          hasTaxInvoice: product.hasTaxInvoice || false,
          paymentNote: product.paymentNote || '',
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadReviews = useCallback(async () => {
    const product = company?.upsellAssignments?.[0]?.product;
    if (!product) return;
    try {
      const data = await apiGet<{ reviews: Review[] }>(`/api/upsell/kakaomap/reviews?productId=${product.id}`);
      setReviews(data.reviews);
    } catch (e) {
      console.error(e);
    }
  }, [company]);

  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const loadLogs = useCallback(async (p = 1) => {
    if (!company) return;
    try {
      const data = await apiGet<{ logs: typeof logs; total: number }>(`/api/upsell/logs?pageSize=50&page=${p}&companyId=${company.id}`);
      if (p === 1) {
        setLogs(data.logs);
      } else {
        setLogs(prev => [...prev, ...data.logs]);
      }
      setLogTotal(data.total);
      setLogPage(p);
    } catch (e) {
      console.error(e);
    }
  }, [company]);

  const loadMemos = useCallback(async () => {
    if (!company) return;
    try {
      const data = await apiGet<{ memos: typeof memos }>(`/api/companies/${company.id}/memos`);
      setMemos(data.memos);
    } catch (e) {
      console.error(e);
    }
  }, [company]);

  const handleAddMemo = async () => {
    if (!company || !newMemo.trim()) return;
    try {
      await apiPost(`/api/companies/${company.id}/memos`, { content: newMemo.trim() });
      setNewMemo('');
      await loadMemos();
    } catch (e) {
      alert(e instanceof Error ? e.message : '메모 저장 실패');
    }
  };

  const loadConsultations = useCallback(async () => {
    if (!company) return;
    try {
      const data = await apiGet<{ consultations: typeof consultations }>(`/api/companies/${company.id}/consultations`);
      setConsultations(data.consultations ?? []);
    } catch { /* ignore */ }
  }, [company]);

  const handleAddConsultation = async () => {
    if (!company || !consultForm.content.trim()) return;
    setConsultSaving(true);
    try {
      await apiPost(`/api/companies/${company.id}/consultations`, {
        contactDate: consultForm.contactDate,
        contactType: consultForm.contactType,
        content: consultForm.content.trim(),
        nextContactDate: consultForm.nextContactDate || null,
        nextAction: consultForm.nextAction || null,
      });
      setConsultForm({ contactDate: new Date().toISOString().slice(0,10), contactType: 'phone', content: '', nextContactDate: '', nextAction: '' });
      await loadConsultations();
    } catch (e) {
      alert(e instanceof Error ? e.message : '상담 저장 실패');
    } finally {
      setConsultSaving(false);
    }
  };

  useEffect(() => { loadCompany(); }, [loadCompany]);
  useEffect(() => {
    fetch('/api/auth', { credentials: 'include' }).then(r => r.json()).then(d => { setAuthRole(d.user?.role || ''); setAuthUserId(d.user?.userId || null); }).catch(() => {});
  }, []);
  useEffect(() => { if (tab === '카카오맵 리뷰' && company) loadReviews(); }, [tab, company, loadReviews]);
  useEffect(() => { if (tab === '상담이력' && company) loadConsultations(); }, [tab, company, loadConsultations]);
  useEffect(() => { if (tab === '활동내역' && company) loadLogs(); }, [tab, company, loadLogs]);
  useEffect(() => { if (tab === '기본정보' && company) loadMemos(); }, [tab, company, loadMemos]);

  const assignment = company?.upsellAssignments?.[0];

  // 상품 저장
  const handleSaveProduct = async () => {
    if (!assignment) { alert('먼저 업체를 분배받아야 합니다.'); return; }
    // 리뷰 수 초과 검증
    if (form.reviewType !== 'kakao_only' && form.receiptReviewCount > form.receiptReviewTarget) {
      alert(`영수증 리뷰 수(${form.receiptReviewCount})가 목표(${form.receiptReviewTarget})를 초과합니다.`); return;
    }
    if (form.reviewType !== 'receipt_only' && form.kakaoReviewCount > form.kakaoReviewTarget) {
      alert(`카카오 리뷰 수(${form.kakaoReviewCount})가 목표(${form.kakaoReviewTarget})를 초과합니다.`); return;
    }
    setSaving(true);
    try {
      await apiPost('/api/upsell/products', { assignmentId: assignment.id, ...form });
      alert('저장되었습니다.');
      await loadCompany();
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  // 결제 저장
  const handleSavePayment = async () => {
    const prod = assignment?.product;
    if (!prod) return;
    setSavingPayment(true);
    try {
      await apiPost('/api/upsell/payment', {
        productId: prod.id,
        ...paymentForm,
      });
      alert('결제 정보가 저장되었습니다.');
      await loadCompany();
    } catch (e) {
      alert(e instanceof Error ? e.message : '결제 저장 실패');
    } finally {
      setSavingPayment(false);
    }
  };

  // 리뷰 개수 연동 (한쪽 변경 시 나머지 자동 조정)
  const updateReviewTarget = (field: 'receiptReviewTarget' | 'kakaoReviewTarget', value: number) => {
    const total = form.totalReviewTarget;
    const clamped = Math.max(0, Math.min(total, value));
    if (field === 'receiptReviewTarget') {
      setForm({ ...form, receiptReviewTarget: clamped, kakaoReviewTarget: total - clamped });
    } else {
      setForm({ ...form, kakaoReviewTarget: clamped, receiptReviewTarget: total - clamped });
    }
  };

  const updateTotalTarget = (value: number) => {
    const total = Math.max(0, value);
    const ratio = form.totalReviewTarget > 0 ? form.receiptReviewTarget / form.totalReviewTarget : 0.5;
    const receipt = Math.round(total * ratio);
    setForm({ ...form, totalReviewTarget: total, receiptReviewTarget: receipt, kakaoReviewTarget: total - receipt });
  };

  // 카카오맵 검색
  const handleKakaoSearch = async () => {
    if (!kakaoSearch.trim()) return;
    setKakaoSearching(true);
    try {
      const data = await apiGet<{ places: KakaoPlace[] }>(`/api/upsell/kakaomap/search?q=${encodeURIComponent(kakaoSearch)}`);
      setKakaoResults(data.places);
    } catch (e) {
      console.error(e);
    } finally {
      setKakaoSearching(false);
    }
  };

  const selectKakaoPlace = (place: KakaoPlace) => {
    setForm({ ...form, kakaoMapUrl: place.url, kakaoMapPlaceId: place.id, kakaoMapName: place.name });
    setKakaoResults([]);
    setKakaoSearch('');
  };

  // 리뷰 갱신
  const handleRefreshReviews = async () => {
    const product = assignment?.product;
    if (!product) return;
    setRefreshing(true);
    try {
      const result = await apiPost<{ message: string }>('/api/upsell/kakaomap/reviews', { productId: product.id, action: 'refresh' });
      alert(result.message);
      await loadReviews();
    } catch (e) {
      alert(e instanceof Error ? e.message : '갱신 실패');
    } finally {
      setRefreshing(false);
    }
  };

  // 리뷰 확인
  const handleConfirmReviews = async () => {
    const product = assignment?.product;
    if (!product || selectedReviews.size === 0) return;
    try {
      await apiPost('/api/upsell/kakaomap/reviews', { productId: product.id, action: 'confirm', reviewIds: Array.from(selectedReviews) });
      setSelectedReviews(new Set());
      await loadReviews();
    } catch (e) {
      alert(e instanceof Error ? e.message : '확인 실패');
    }
  };

  // 수동 리뷰 추가
  const handleAddManualReview = async () => {
    const product = assignment?.product;
    if (!product) return;
    try {
      await apiPost('/api/upsell/kakaomap/reviews', { productId: product.id, action: 'manual', ...manualReview });
      setShowManualForm(false);
      setManualReview({ author: '', content: '', rating: 5 });
      await loadReviews();
    } catch (e) {
      alert(e instanceof Error ? e.message : '추가 실패');
    }
  };

  if (loading) return <div style={{ padding: 32, color: '#64748b' }}>로딩중...</div>;
  if (!company) return <div style={{ padding: 32, color: '#ef4444' }}>업체를 찾을 수 없습니다.</div>;

  const product = assignment?.product;
  const confirmedCount = reviews.filter((r) => r.isOurs).length;

  const S = { label: { fontSize: 13, color: '#374151', display: 'block', marginBottom: 4 } as const, input: { display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' as const } };

  return (
    <div className="crm-page">
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <Link href="/upsell/companies" style={{ color: '#64748b', textDecoration: 'none', fontSize: 14 }}>← 목록</Link>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: assignment?.isExcluded ? '#94a3b8' : '#0f172a', textDecoration: assignment?.isExcluded ? 'line-through' : 'none' }}>{company.companyName}</h1>
        {assignment?.isExcluded && (
          <span style={{ background: '#fecaca', color: '#dc2626', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600 }}>제외가망</span>
        )}
        {assignment && (
          <span style={{ background: '#ede9fe', color: '#7c3aed', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>
            담당: {assignment.assignedTo.displayName}
          </span>
        )}
        {assignment && (assignment.assignedTo.id === authUserId || authRole === 'admin' || authRole === 'upselling_director') && (
          <button onClick={async () => {
            try {
              await apiPost('/api/upsell/exclude', { assignmentId: assignment.id, isExcluded: !assignment.isExcluded });
              await loadCompany();
            } catch (e) { alert(e instanceof Error ? e.message : '처리 실패'); }
          }}
            style={{
              padding: '4px 12px', border: '1px solid', borderRadius: 4, fontSize: 12, cursor: 'pointer', fontWeight: 500,
              background: assignment.isExcluded ? '#fef2f2' : '#f8fafc',
              borderColor: assignment.isExcluded ? '#fecaca' : '#e2e8f0',
              color: assignment.isExcluded ? '#dc2626' : '#64748b',
            }}>
            {assignment.isExcluded ? '제외 해제' : '제외가망 설정'}
          </button>
        )}
        {assignment && (authRole === 'admin' || authRole === 'upselling_director') && (
          <button onClick={async () => {
            if (!confirm(`"${company.companyName}" 배분을 취소하시겠습니까?\n상품 설정도 함께 삭제됩니다.`)) return;
            try {
              await apiDelete(`/api/upsell/distribution?id=${assignment.id}`);
              window.location.href = '/upsell/companies';
            } catch (e) { alert(e instanceof Error ? e.message : '배분 취소 실패'); }
          }}
            style={{ padding: '4px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 12, cursor: 'pointer', color: '#dc2626', fontWeight: 500 }}>
            배분 취소
          </button>
        )}
      </div>

      {/* 탭 */}
      <div className="tab-bar">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 20px', fontSize: 13, fontWeight: tab === t ? 600 : 400, cursor: 'pointer',
            color: tab === t ? '#8b5cf6' : '#64748b', background: 'none', border: 'none',
            borderBottom: tab === t ? '2px solid #8b5cf6' : '2px solid transparent',
          }}>{t}</button>
        ))}
      </div>

      {/* 기본정보 탭 */}
      {tab === '기본정보' && (
        <>
        <div className="grid-2col">
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>업체 정보</h3>
              {(authRole === 'admin' || authRole === 'upselling_director') && !editMode && (
                <button onClick={() => {
                  setEditForm({
                    companyName: company.companyName, representative: company.representative,
                    phone: company.phone, staffName: company.staffName, managerName: company.managerName,
                  });
                  setEditMode(true);
                }} style={{ padding: '4px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>수정</button>
              )}
            </div>
            {editMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { key: 'companyName', label: '업체명' },
                  { key: 'representative', label: '대표자' },
                  { key: 'phone', label: '연락처' },
                  { key: 'staffName', label: '담당자' },
                  { key: 'managerName', label: '간부' },
                ].map(({ key, label }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ width: 80, color: '#64748b', flexShrink: 0 }}>{label}</span>
                    <input value={editForm[key as keyof typeof editForm]}
                      onChange={(e) => setEditForm({ ...editForm, [key]: e.target.value })}
                      style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }} />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button onClick={() => setEditMode(false)} style={{ padding: '6px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>취소</button>
                  <button onClick={async () => {
                    try {
                      await apiPost(`/api/upsell/companies/${company.id}/update`, editForm);
                      setEditMode(false);
                      await loadCompany();
                    } catch (e) { alert(e instanceof Error ? e.message : '수정 실패'); }
                  }} style={{ padding: '6px 14px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>저장</button>
                </div>
              </div>
            ) : (
              <>
                {[
                  ['업체명', company.companyName], ['대표자', company.representative], ['연락처', company.phone, true],
                  ['지사', company.branch || '-'], ['결제일', new Date(company.paymentDate).toLocaleDateString('ko-KR')],
                  ['담당자', company.staffName], ['간부', company.managerName],
                  ['카드사', company.cardCompany || '-'],
                  ['결제금액', company.paymentAmount ? `${company.paymentAmount.toLocaleString()}원` : '-'],
                ].map(([label, value, isPhone]) => (
                  <div key={String(label)} style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                    <span style={{ width: 100, color: '#64748b', flexShrink: 0 }}>{label}</span>
                    <span style={{ fontWeight: 500 }}>
                      {isPhone && value ? <a href={`tel:${value}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{value}</a> : value}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
          {product && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>상품 요약</h3>
              {[
                ['파워링크', product.hasPowerlink ? (product.powerlinkDone ? '완료' : '진행중') : '-'],
                ['영수증리뷰', product.reviewType !== 'kakao_only' ? `${product.receiptReviewCount}/${product.receiptReviewTarget}건` : '-'],
                ['카카오리뷰', product.reviewType !== 'receipt_only' ? `${product.kakaoReviewCount}/${product.kakaoReviewTarget}건` : '-'],
                ['채널', product.channelType === 'kakao_channel' ? `카카오채널 ${product.channelDone ? '(완료)' : '(진행중)'}` : product.channelType === 'blog_skin' ? `블로그스킨 ${product.channelDone ? '(완료)' : '(진행중)'}` : '-'],
                ['업셀금액', product.upsellAmount ? `${product.upsellAmount.toLocaleString()}원` : '-'],
                ['카카오맵', product.kakaoMapName || '-'],
                ['확인 리뷰', `${product.exposureCount}건`],
              ].map(([label, value]) => (
                <div key={label} style={{ display: 'flex', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ width: 100, color: '#64748b', flexShrink: 0 }}>{label}</span>
                  <span style={{ fontWeight: 500 }}>{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 특이사항 (메모) */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>특이사항</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input value={newMemo} onChange={(e) => setNewMemo(e.target.value)} placeholder="특이사항을 입력하세요..."
              onKeyDown={(e) => e.key === 'Enter' && handleAddMemo()}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            <button onClick={handleAddMemo} style={{ padding: '8px 16px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>등록</button>
          </div>
          {memos.length === 0 ? (
            <div style={{ padding: 12, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>등록된 특이사항이 없습니다.</div>
          ) : memos.map((m) => (
            <div key={m.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <div style={{ color: '#374151' }}>{m.content}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{m.user.displayName} · {new Date(m.createdAt).toLocaleString('ko-KR')}</div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* 상품설정 탭 */}
      {tab === '상품설정' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px', maxWidth: 700 }}>
          {!assignment ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>이 업체는 아직 분배되지 않았습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* 종합 진행률 */}
              {product && (
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>서비스 진행률</div>
                  {(() => {
                    let total = 0, done = 0;
                    if (product.hasPowerlink) { total++; if (product.powerlinkDone) done++; }
                    if (product.channelType !== 'none') { total++; if (product.channelDone) done++; }
                    if (product.reviewType !== 'kakao_only' && product.receiptReviewTarget > 0) {
                      total++; if (product.receiptReviewCount >= product.receiptReviewTarget) done++;
                    }
                    if (product.reviewType !== 'receipt_only' && product.kakaoReviewTarget > 0) {
                      total++; if (product.kakaoReviewCount >= product.kakaoReviewTarget) done++;
                    }
                    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                    return (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <div style={{ flex: 1, height: 10, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? '#22c55e' : '#8b5cf6', borderRadius: 5, transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: pct === 100 ? '#22c55e' : '#8b5cf6' }}>{pct}%</span>
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
                          {product.hasPowerlink && <span>{product.powerlinkDone ? '✓' : '○'} 파워링크</span>}
                          {product.channelType !== 'none' && <span>{product.channelDone ? '✓' : '○'} {product.channelType === 'kakao_channel' ? '카카오채널' : '블로그스킨'}</span>}
                          {product.reviewType !== 'kakao_only' && product.receiptReviewTarget > 0 && (
                            <span>{product.receiptReviewCount >= product.receiptReviewTarget ? '✓' : '○'} 영수증리뷰 {product.receiptReviewCount}/{product.receiptReviewTarget}</span>
                          )}
                          {product.reviewType !== 'receipt_only' && product.kakaoReviewTarget > 0 && (
                            <span>{product.kakaoReviewCount >= product.kakaoReviewTarget ? '✓' : '○'} 카카오리뷰 {product.kakaoReviewCount}/{product.kakaoReviewTarget}</span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 계약기간 */}
              <div>
                <span style={S.label}>계약기간</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="date" value={form.contractStart} onChange={(e) => setForm({ ...form, contractStart: e.target.value })} style={{ ...S.input, width: 'auto' }} />
                  <span>~</span>
                  <input type="date" value={form.contractEnd} onChange={(e) => setForm({ ...form, contractEnd: e.target.value })} style={{ ...S.input, width: 'auto' }} />
                </div>
              </div>

              {/* 파워링크 */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                  <input type="checkbox" checked={form.hasPowerlink} onChange={(e) => setForm({ ...form, hasPowerlink: e.target.checked })} />
                  파워링크 컨설팅
                </label>
                {form.hasPowerlink && (
                  <div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13 }}>
                      <input type="checkbox" checked={form.powerlinkDone} onChange={(e) => setForm({ ...form, powerlinkDone: e.target.checked })} />
                      <span style={{ color: form.powerlinkDone ? '#22c55e' : '#64748b', fontWeight: 500 }}>{form.powerlinkDone ? '처리 완료' : '미처리'}</span>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label><span style={S.label}>광고주 아이디</span>
                      <input value={form.powerlinkAdId} onChange={(e) => setForm({ ...form, powerlinkAdId: e.target.value })} style={S.input} />
                    </label>
                    <label><span style={S.label}>비밀번호</span>
                      <input type="password" value={form.powerlinkAdPassword} onChange={(e) => setForm({ ...form, powerlinkAdPassword: e.target.value })} style={S.input} />
                    </label>
                  </div>
                  </div>
                )}
              </div>

              {/* 리뷰 설정 */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>리뷰 설정</div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                  {(['both', 'receipt_only', 'kakao_only'] as const).map((type) => (
                    <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                      <input type="radio" name="reviewType" value={type} checked={form.reviewType === type}
                        onChange={() => {
                          const total = form.totalReviewTarget;
                          if (type === 'receipt_only') setForm({ ...form, reviewType: type, receiptReviewTarget: total, kakaoReviewTarget: 0 });
                          else if (type === 'kakao_only') setForm({ ...form, reviewType: type, receiptReviewTarget: 0, kakaoReviewTarget: total });
                          else setForm({ ...form, reviewType: type, receiptReviewTarget: Math.floor(total / 2), kakaoReviewTarget: total - Math.floor(total / 2) });
                        }} />
                      {type === 'both' ? '영수증+카카오' : type === 'receipt_only' ? '영수증만' : '카카오만'}
                    </label>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <label><span style={S.label}>총 개수</span>
                    <input type="number" value={form.totalReviewTarget} onChange={(e) => updateTotalTarget(parseInt(e.target.value) || 0)} style={S.input} />
                  </label>
                  <label><span style={S.label}>영수증리뷰</span>
                    <input type="number" value={form.receiptReviewTarget} disabled={form.reviewType === 'kakao_only'}
                      onChange={(e) => updateReviewTarget('receiptReviewTarget', parseInt(e.target.value) || 0)} style={{ ...S.input, background: form.reviewType === 'kakao_only' ? '#f1f5f9' : '' }} />
                  </label>
                  <label><span style={S.label}>카카오리뷰</span>
                    <input type="number" value={form.kakaoReviewTarget} disabled={form.reviewType === 'receipt_only'}
                      onChange={(e) => updateReviewTarget('kakaoReviewTarget', parseInt(e.target.value) || 0)} style={{ ...S.input, background: form.reviewType === 'receipt_only' ? '#f1f5f9' : '' }} />
                  </label>
                </div>
                {/* 슬라이더 */}
                {form.reviewType === 'both' && form.totalReviewTarget > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <input type="range" min={0} max={form.totalReviewTarget} value={form.receiptReviewTarget}
                      onChange={(e) => updateReviewTarget('receiptReviewTarget', parseInt(e.target.value))}
                      style={{ width: '100%', accentColor: '#8b5cf6' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }}>
                      <span>영수증 {form.receiptReviewTarget}</span>
                      <span>카카오 {form.kakaoReviewTarget}</span>
                    </div>
                  </div>
                )}
                {/* 리뷰 처리 현황 */}
                <div style={{ marginTop: 16, padding: '12px', background: '#f8fafc', borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#475569' }}>처리 현황</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <label><span style={S.label}>영수증리뷰 처리 건수</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="number" value={form.receiptReviewCount} min={0} max={form.receiptReviewTarget}
                          disabled={form.reviewType === 'kakao_only'}
                          onChange={(e) => setForm({ ...form, receiptReviewCount: parseInt(e.target.value) || 0 })}
                          style={{ ...S.input, background: form.reviewType === 'kakao_only' ? '#f1f5f9' : '' }} />
                        <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>/ {form.receiptReviewTarget}</span>
                      </div>
                    </label>
                    <label><span style={S.label}>카카오리뷰 처리 건수</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="number" value={form.kakaoReviewCount} min={0} max={form.kakaoReviewTarget}
                          disabled={form.reviewType === 'receipt_only'}
                          onChange={(e) => setForm({ ...form, kakaoReviewCount: parseInt(e.target.value) || 0 })}
                          style={{ ...S.input, background: form.reviewType === 'receipt_only' ? '#f1f5f9' : '' }} />
                        <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>/ {form.kakaoReviewTarget}</span>
                      </div>
                    </label>
                  </div>
                  {form.totalReviewTarget > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 3, transition: 'width 0.3s',
                          width: `${Math.min(100, ((form.receiptReviewCount + form.kakaoReviewCount) / form.totalReviewTarget) * 100)}%`,
                          background: (form.receiptReviewCount + form.kakaoReviewCount) >= form.totalReviewTarget ? '#22c55e' : '#8b5cf6',
                        }} />
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, textAlign: 'right' }}>
                        {form.receiptReviewCount + form.kakaoReviewCount} / {form.totalReviewTarget} ({Math.round(((form.receiptReviewCount + form.kakaoReviewCount) / (form.totalReviewTarget || 1)) * 100)}%)
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 카카오채널/블로그스킨 */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>카카오채널 / 블로그스킨</div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                  {(['none', 'kakao_channel', 'blog_skin'] as const).map((type) => (
                    <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                      <input type="radio" name="channelType" value={type} checked={form.channelType === type}
                        onChange={() => setForm({ ...form, channelType: type, channelDone: false })} />
                      {type === 'none' ? '없음' : type === 'kakao_channel' ? '카카오채널' : '블로그스킨'}
                    </label>
                  ))}
                </div>
                {form.channelType !== 'none' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <input type="checkbox" checked={form.channelDone} onChange={(e) => setForm({ ...form, channelDone: e.target.checked })} />
                    <span style={{ color: form.channelDone ? '#22c55e' : '#64748b', fontWeight: 500 }}>
                      {form.channelDone ? '처리 완료' : '미처리'}
                    </span>
                  </label>
                )}
              </div>

              {/* 카카오맵 연동 */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>카카오맵 연동</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <input placeholder="업체명으로 검색" value={kakaoSearch}
                    onChange={(e) => setKakaoSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleKakaoSearch()}
                    style={{ ...S.input, flex: 1 }} />
                  <button onClick={handleKakaoSearch} disabled={kakaoSearching}
                    style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    {kakaoSearching ? '검색중...' : '검색'}
                  </button>
                </div>
                {kakaoResults.length > 0 && (
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, maxHeight: 200, overflow: 'auto', marginBottom: 8 }}>
                    {kakaoResults.map((p) => (
                      <div key={p.id} onClick={() => selectKakaoPlace(p)}
                        style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13 }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f3ff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{p.address} {p.phone && `· ${p.phone}`}</div>
                      </div>
                    ))}
                  </div>
                )}
                {form.kakaoMapName && (
                  <div style={{ background: '#f5f3ff', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>
                    선택됨: <strong>{form.kakaoMapName}</strong>
                    {form.kakaoMapUrl && <a href={form.kakaoMapUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8, color: '#8b5cf6' }}>링크</a>}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <span style={S.label}>또는 URL 직접 입력</span>
                  <input value={form.kakaoMapUrl} onChange={(e) => setForm({ ...form, kakaoMapUrl: e.target.value })} placeholder="https://place.map.kakao.com/..." style={S.input} />
                </div>
              </div>

              {/* 기타 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                <label><span style={S.label}>업셀 판매금액 (원)</span>
                  <input type="number" value={form.upsellAmount} onChange={(e) => setForm({ ...form, upsellAmount: e.target.value })} style={S.input} />
                </label>
              </div>

              <button onClick={handleSaveProduct} disabled={saving}
                style={{ padding: '12px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.5 : 1 }}>
                {saving ? '저장 중...' : '상품 설정 저장'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 결제관리 탭 */}
      {tab === '결제관리' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '16px 20px', maxWidth: 700 }}>
          {!assignment?.product ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>먼저 상품 설정을 완료해주세요.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* 결제 상태 */}
              <div>
                <span style={S.label}>결제 상태</span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {([
                    { value: 'unpaid', label: '계약전', color: '#94a3b8', bg: '#f1f5f9' },
                    { value: 'paid', label: '계약완료', color: '#16a34a', bg: '#f0fdf4' },
                    { value: 'churned', label: '해지완료', color: '#dc2626', bg: '#fef2f2' },
                  ] as const).map((s) => (
                    <button key={s.value} onClick={() => setPaymentForm({ ...paymentForm, paymentStatus: s.value })}
                      style={{
                        padding: '10px 20px', border: '2px solid', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        borderRadius: 8, transition: 'all 0.15s',
                        borderColor: paymentForm.paymentStatus === s.value ? s.color : '#e2e8f0',
                        background: paymentForm.paymentStatus === s.value ? s.bg : '#fff',
                        color: paymentForm.paymentStatus === s.value ? s.color : '#64748b',
                      }}>
                      {s.label}
                    </button>
                  ))}
                </div>
                {product?.paidAt && paymentForm.paymentStatus === 'paid' && (
                  <div style={{ fontSize: 12, color: '#16a34a', marginTop: 6 }}>
                    결제일: {new Date(product.paidAt).toLocaleDateString('ko-KR')}
                  </div>
                )}
              </div>

              {/* 계약 금액 */}
              {paymentForm.paymentStatus !== 'unpaid' && (
                <div>
                  <span style={S.label}>계약 금액 (원)</span>
                  <input type="number" value={paymentForm.paymentCardAmount || ''}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentCardAmount: e.target.value })}
                    placeholder="계약 금액을 입력하세요"
                    style={{ display: 'block', width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' as const }} />
                </div>
              )}

              {/* 결제 수단 */}
              {paymentForm.paymentStatus !== 'unpaid' && paymentForm.paymentStatus !== 'churned' && (
                <>
                  <div>
                    <span style={S.label}>결제 수단</span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {([
                        { value: 'card', label: '카드' },
                        { value: 'cash', label: '현금' },
                        { value: 'mixed', label: '카드 + 현금' },
                      ] as const).map((m) => (
                        <label key={m.value} style={{
                          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                          border: '1px solid', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                          borderColor: paymentForm.paymentMethod === m.value ? '#8b5cf6' : '#e2e8f0',
                          background: paymentForm.paymentMethod === m.value ? '#f5f3ff' : '#fff',
                        }}>
                          <input type="radio" name="paymentMethod" value={m.value}
                            checked={paymentForm.paymentMethod === m.value}
                            onChange={() => setPaymentForm({ ...paymentForm, paymentMethod: m.value })}
                            style={{ accentColor: '#8b5cf6' }} />
                          {m.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* 카드 결제 상세 */}
                  {(paymentForm.paymentMethod === 'card' || paymentForm.paymentMethod === 'mixed') && (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>카드 결제 정보</div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                        {([
                          { value: 'new_card', label: '새 카드' },
                          { value: 'existing_card', label: '이전 카드' },
                        ] as const).map((ct) => (
                          <label key={ct.value} style={{
                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                            border: '1px solid', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                            borderColor: paymentForm.paymentCardType === ct.value ? '#8b5cf6' : '#e2e8f0',
                            background: paymentForm.paymentCardType === ct.value ? '#f5f3ff' : '#fff',
                          }}>
                            <input type="radio" name="cardType" value={ct.value}
                              checked={paymentForm.paymentCardType === ct.value}
                              onChange={() => setPaymentForm({ ...paymentForm, paymentCardType: ct.value })}
                              style={{ accentColor: '#8b5cf6' }} />
                            {ct.label}
                          </label>
                        ))}
                      </div>
                      <div className="payment-grid">
                        <label><span style={S.label}>카드사</span>
                          <select value={paymentForm.paymentCardCompany}
                            onChange={(e) => setPaymentForm({ ...paymentForm, paymentCardCompany: e.target.value })}
                            style={S.input}>
                            <option value="">선택</option>
                            {['삼성', '현대', '국민(KB)', '신한', '롯데', '하나', 'BC', 'NH', '우리', '씨티'].map((c) => (
                              <option key={c} value={c}>{c}카드</option>
                            ))}
                          </select>
                        </label>
                        <label><span style={S.label}>카드 결제 금액 (원)</span>
                          <input type="number" value={paymentForm.paymentCardAmount}
                            onChange={(e) => setPaymentForm({ ...paymentForm, paymentCardAmount: e.target.value })}
                            placeholder="0" style={S.input} />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* 현금 결제 상세 */}
                  {(paymentForm.paymentMethod === 'cash' || paymentForm.paymentMethod === 'mixed') && (
                    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>현금 결제 정보</div>
                      <label><span style={S.label}>현금 결제 금액 (원)</span>
                        <input type="number" value={paymentForm.paymentCashAmount}
                          onChange={(e) => setPaymentForm({ ...paymentForm, paymentCashAmount: e.target.value })}
                          placeholder="0" style={{ ...S.input, maxWidth: 300 }} />
                      </label>
                    </div>
                  )}

                  {/* 세금계산서 */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
                    <input type="checkbox" checked={paymentForm.hasTaxInvoice}
                      onChange={(e) => setPaymentForm({ ...paymentForm, hasTaxInvoice: e.target.checked })}
                      style={{ width: 18, height: 18, accentColor: '#8b5cf6' }} />
                    세금계산서 발행
                  </label>

                  {/* 결제 메모 */}
                  <div>
                    <span style={S.label}>결제 메모</span>
                    <textarea value={paymentForm.paymentNote}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentNote: e.target.value })}
                      placeholder="결제 관련 특이사항..."
                      style={{ ...S.input, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>

                  {/* 금액 요약 */}
                  {paymentForm.paymentMethod === 'mixed' && (paymentForm.paymentCardAmount || paymentForm.paymentCashAmount) && (
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: 16, fontSize: 13 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>결제 금액 요약</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                        <span style={{ color: '#64748b' }}>카드</span>
                        <span>{parseInt(paymentForm.paymentCardAmount || '0').toLocaleString()}원</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                        <span style={{ color: '#64748b' }}>현금</span>
                        <span>{parseInt(paymentForm.paymentCashAmount || '0').toLocaleString()}원</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '1px solid #e2e8f0', marginTop: 4, fontWeight: 700 }}>
                        <span>합계</span>
                        <span style={{ color: '#8b5cf6' }}>
                          {(parseInt(paymentForm.paymentCardAmount || '0') + parseInt(paymentForm.paymentCashAmount || '0')).toLocaleString()}원
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 저장 버튼 */}
              <button onClick={handleSavePayment} disabled={savingPayment}
                style={{
                  padding: '12px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: savingPayment ? 0.5 : 1,
                }}>
                {savingPayment ? '저장 중...' : '결제 정보 저장'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 카카오맵 리뷰 탭 */}
      {tab === '카카오맵 리뷰' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          {!product ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>먼저 상품 설정에서 카카오맵을 연동하세요.</div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 14 }}>
                  전체 <strong>{reviews.length}</strong>건 · 확인됨 <strong style={{ color: '#22c55e' }}>{confirmedCount}</strong>건
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setShowManualForm(!showManualForm)}
                    style={{ padding: '6px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                    수동 추가
                  </button>
                  <button onClick={handleRefreshReviews} disabled={refreshing}
                    style={{ padding: '6px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                    {refreshing ? '갱신중...' : '리뷰 갱신'}
                  </button>
                  {selectedReviews.size > 0 && (
                    <button onClick={handleConfirmReviews}
                      style={{ padding: '6px 12px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
                      {selectedReviews.size}건 확인
                    </button>
                  )}
                </div>
              </div>

              {showManualForm && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 16, background: '#f8fafc' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 8 }}>
                    <input placeholder="작성자" value={manualReview.author} onChange={(e) => setManualReview({ ...manualReview, author: e.target.value })}
                      style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
                    <input placeholder="내용" value={manualReview.content} onChange={(e) => setManualReview({ ...manualReview, content: e.target.value })}
                      style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
                    <button onClick={handleAddManualReview}
                      style={{ padding: '7px 14px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>추가</button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {reviews.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>리뷰가 없습니다. &quot;리뷰 갱신&quot;을 눌러 카카오맵에서 가져오세요.</div>
                ) : reviews.map((r) => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                    border: '1px solid', borderColor: r.isOurs ? '#bbf7d0' : '#e2e8f0',
                    borderRadius: 6, background: r.isOurs ? '#f0fdf4' : '#fff',
                  }}>
                    <input type="checkbox" checked={selectedReviews.has(r.id) || r.isOurs} disabled={r.isOurs}
                      onChange={() => {
                        const next = new Set(selectedReviews);
                        if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                        setSelectedReviews(next);
                      }}
                      style={{ marginTop: 4 }} />
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <strong>{r.author}</strong>
                        {r.rating > 0 && <span style={{ color: '#f59e0b', fontSize: 12 }}>{'★'.repeat(r.rating)}</span>}
                        {r.isManual && <span style={{ background: '#ede9fe', color: '#7c3aed', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>수동</span>}
                        {r.isOurs && <span style={{ background: '#dcfce7', color: '#16a34a', padding: '1px 4px', borderRadius: 3, fontSize: 10 }}>확인됨</span>}
                      </div>
                      {r.title && <div style={{ fontWeight: 500, marginBottom: 2 }}>{r.title}</div>}
                      <div style={{ color: '#374151', lineHeight: 1.5 }}>{r.content}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                        {new Date(r.fetchedAt).toLocaleDateString('ko-KR')}
                        {r.confirmedBy && ` · ${r.confirmedBy.displayName}이(가) 확인`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 상담이력 탭 */}
      {tab === '상담이력' && (
        <div style={{ maxWidth: 800 }}>
          {/* 상담 등록 폼 */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>상담 등록</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <span style={S.label}>상담일</span>
                  <input type="date" value={consultForm.contactDate} onChange={(e) => setConsultForm({ ...consultForm, contactDate: e.target.value })} style={S.input} />
                </div>
                <div>
                  <span style={S.label}>상담유형</span>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {([{ value: 'phone', label: '전화' }, { value: 'visit', label: '방문' }, { value: 'kakao', label: '카카오톡' }] as const).map((t) => (
                      <label key={t.value} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                        <input type="radio" name="consultType" value={t.value} checked={consultForm.contactType === t.value}
                          onChange={() => setConsultForm({ ...consultForm, contactType: t.value })} style={{ accentColor: '#8b5cf6' }} />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <span style={S.label}>상담내용</span>
                <textarea value={consultForm.content} onChange={(e) => setConsultForm({ ...consultForm, content: e.target.value })}
                  placeholder="상담 내용을 입력하세요..."
                  style={{ ...S.input, minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <span style={S.label}>다음 연락일</span>
                  <input type="date" value={consultForm.nextContactDate} onChange={(e) => setConsultForm({ ...consultForm, nextContactDate: e.target.value })} style={S.input} />
                </div>
                <div style={{ flex: 1 }}>
                  <span style={S.label}>다음 조치사항</span>
                  <input value={consultForm.nextAction} onChange={(e) => setConsultForm({ ...consultForm, nextAction: e.target.value })}
                    placeholder="다음 조치사항..." style={S.input} />
                </div>
              </div>
              <button onClick={handleAddConsultation} disabled={consultSaving || !consultForm.content.trim()}
                style={{ padding: '10px 20px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start', opacity: consultSaving || !consultForm.content.trim() ? 0.5 : 1 }}>
                {consultSaving ? '저장 중...' : '상담 등록'}
              </button>
            </div>
          </div>

          {/* 상담 이력 목록 */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>상담 이력 ({consultations.length}건)</h3>
            {consultations.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>상담 이력이 없습니다.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {consultations.map((c) => {
                  const typeCfg = c.contactType === 'phone' ? { label: '전화', bg: '#dbeafe', color: '#2563eb' }
                    : c.contactType === 'visit' ? { label: '방문', bg: '#dcfce7', color: '#16a34a' }
                    : c.contactType === 'kakao' ? { label: '카카오톡', bg: '#fef9c3', color: '#a16207' }
                    : { label: c.contactType, bg: '#f1f5f9', color: '#64748b' };
                  return (
                    <div key={c.id} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ background: typeCfg.bg, color: typeCfg.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                          {typeCfg.label}
                        </span>
                        <span style={{ fontSize: 12, color: '#64748b' }}>{new Date(c.contactDate).toLocaleDateString('ko-KR')}</span>
                        <span style={{ fontSize: 12, color: '#94a3b8' }}>{c.user.displayName}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{c.content}</div>
                      {(c.nextContactDate || c.nextAction) && (
                        <div style={{ marginTop: 8, padding: '6px 10px', background: '#f8fafc', borderRadius: 4, fontSize: 12, color: '#64748b' }}>
                          {c.nextContactDate && <span>다음연락: {new Date(c.nextContactDate).toLocaleDateString('ko-KR')}</span>}
                          {c.nextContactDate && c.nextAction && <span> · </span>}
                          {c.nextAction && <span>조치: {c.nextAction}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 활동내역 탭 */}
      {tab === '활동내역' && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 24 }}>
          {logs.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>활동 내역이 없습니다.</div>
          ) : (
            <>
              {logs.map((l) => (
                <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <div>
                    <span style={{ fontWeight: 500 }}>{l.action}</span>
                    {l.details && <span style={{ color: '#64748b', marginLeft: 8 }}>{l.details}</span>}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {l.user.displayName} · {new Date(l.createdAt).toLocaleDateString('ko-KR')}
                  </div>
                </div>
              ))}
              {logs.length < logTotal && (
                <button onClick={() => loadLogs(logPage + 1)}
                  style={{ width: '100%', padding: 10, marginTop: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#64748b' }}>
                  더보기 ({logs.length}/{logTotal})
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
