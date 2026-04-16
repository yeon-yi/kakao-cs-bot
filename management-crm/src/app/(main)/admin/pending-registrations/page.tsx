"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

type Status = 'pending' | 'failed' | 'manual';

interface Item {
  id: number;
  action: string;
  placeId: string | null;
  businessName: string | null;
  keyword: string | null;
  errorMessage: string | null;
  actorName: string;
  actorBranch: string | null;
  createdAt: string;
  status: Status;
  company: {
    id: number;
    placeId: string | null;
    companyName: string;
    staffName: string;
    branch: string | null;
    managerName: string;
  } | null;
}

interface Summary {
  total: number;
  pending: number;
  failed: number;
  manual: number;
}

const STATUS_LABELS: Record<Status, { label: string; color: string }> = {
  pending: { label: '진행 중', color: 'bg-blue-100 text-blue-700' },
  failed: { label: '실패', color: 'bg-red-100 text-red-700' },
  manual: { label: '수동 필요', color: 'bg-yellow-100 text-yellow-700' },
};

const ACTION_LABELS: Record<string, string> = {
  register: '키워드',
  register_report: '리포트',
};

export default function PendingRegistrationsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, pending: 0, failed: 0, manual: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [retrying, setRetrying] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/pending-registrations', { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 403) setToast({ msg: '관리자만 조회 가능합니다', type: 'error' });
        else setToast({ msg: `조회 실패 (HTTP ${res.status})`, type: 'error' });
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
      setSummary(data.summary || { total: 0, pending: 0, failed: 0, manual: 0 });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function triggerRetry() {
    if (retrying) return;
    setRetrying(true);
    try {
      const res = await fetch('/api/admin/pending-registrations', {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (data.ok) {
        const r = data.results;
        setToast({
          msg: `재시도 완료 — 성공 ${r.succeeded}건, 실패 ${r.stillFailed}건, 스킵 ${r.skipped}건`,
          type: 'success',
        });
        await load();
      } else {
        setToast({ msg: data.message || '재시도 실패', type: 'error' });
      }
    } catch {
      setToast({ msg: '재시도 중 오류', type: 'error' });
    } finally {
      setRetrying(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter(i => i.status === filter);
  }, [items, filter]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">등록 진행/실패 건 추적</h1>
          <p className="text-sm text-gray-500 mt-1">advance-step 백그라운드 처리 중이거나 실패한 모집플레이스 등록 건</p>
        </div>
        <button
          onClick={triggerRetry}
          disabled={retrying}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
        >
          {retrying ? '재시도 중...' : '지금 재시도'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <StatCard label="전체" value={summary.total} active={filter === 'all'} onClick={() => setFilter('all')} />
        <StatCard label="진행 중" value={summary.pending} color="text-blue-600" active={filter === 'pending'} onClick={() => setFilter('pending')} />
        <StatCard label="실패" value={summary.failed} color="text-red-600" active={filter === 'failed'} onClick={() => setFilter('failed')} />
        <StatCard label="수동 필요" value={summary.manual} color="text-yellow-600" active={filter === 'manual'} onClick={() => setFilter('manual')} />
      </div>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">액션</th>
              <th className="px-3 py-2 text-left">업체</th>
              <th className="px-3 py-2 text-left">place_id</th>
              <th className="px-3 py-2 text-left">담당자</th>
              <th className="px-3 py-2 text-left">간부</th>
              <th className="px-3 py-2 text-left">지사</th>
              <th className="px-3 py-2 text-left">에러 메시지</th>
              <th className="px-3 py-2 text-left">생성 시각</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-8 text-gray-500">불러오는 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-gray-500">해당 상태의 건이 없습니다</td></tr>
            ) : filtered.map(item => (
              <tr key={item.id} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_LABELS[item.status].color}`}>
                    {STATUS_LABELS[item.status].label}
                  </span>
                </td>
                <td className="px-3 py-2">{ACTION_LABELS[item.action] || item.action}</td>
                <td className="px-3 py-2">
                  {item.company ? (
                    <Link href={`/companies/${item.company.id}`} className="text-blue-600 hover:underline">
                      {item.company.companyName}
                    </Link>
                  ) : (
                    <span className="text-gray-500">{item.businessName || '-'}</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{item.placeId || '-'}</td>
                <td className="px-3 py-2">{item.company?.staffName || '-'}</td>
                <td className="px-3 py-2">{item.company?.managerName || '-'}</td>
                <td className="px-3 py-2">{item.company?.branch || item.actorBranch || '-'}</td>
                <td className="px-3 py-2 text-gray-600 max-w-xs truncate" title={item.errorMessage || ''}>
                  {item.errorMessage}
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                  {new Date(item.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded shadow-lg ${
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, color = 'text-gray-900', active, onClick,
}: {
  label: string; value: number; color?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white border rounded-lg p-4 transition ${
        active ? 'border-blue-500 ring-2 ring-blue-100' : 'hover:border-gray-400'
      }`}
    >
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
    </button>
  );
}
