'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Pencil, X, Upload } from 'lucide-react';

interface StaffForm {
  realName: string;
  kakaoName: string;
  kakaoUserId: string;
  kakaoRoomId: string;
  email: string;
  phone: string;
  department: string;
  position: string;
}

const emptyForm: StaffForm = {
  realName: '', kakaoName: '', kakaoUserId: '', kakaoRoomId: '', email: '', phone: '', department: '', position: '',
};

export default function StaffTab() {
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [form, setForm] = useState<StaffForm>(emptyForm);

  const utils = trpc.useUtils();
  const { data: staffList, isLoading } = trpc.staff.list.useQuery({
    search: search || undefined,
    activeOnly: !showInactive,
  });

  const createMutation = trpc.staff.create.useMutation({
    onSuccess: () => { utils.staff.list.invalidate(); setIsAdding(false); setForm(emptyForm); },
  });

  const updateMutation = trpc.staff.update.useMutation({
    onSuccess: () => { utils.staff.list.invalidate(); setEditId(null); setForm(emptyForm); },
  });

  const toggleMutation = trpc.staff.toggleActive.useMutation({
    onSuccess: () => utils.staff.list.invalidate(),
  });

  // 엑셀 업로드
  const [uploadPreview, setUploadPreview] = useState<Array<{ realName: string }>>([]);
  const [uploadResult, setUploadResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const bulkImportMutation = trpc.staff.bulkImport.useMutation({
    onSuccess: (result) => {
      setUploadResult(result);
      setUploadPreview([]);
      utils.staff.list.invalidate();
    },
  });

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

      const LOCATIONS = new Set(['안산', '인천', '수원', '동탄', '용인', '부산', '대전', '광주', '대구', '울산', '세종', '서울']);
      const names = new Set<string>();

      for (let i = 1; i < rows.length; i++) {
        for (const cell of (rows[i] || [])) {
          if (!cell || typeof cell !== 'string') continue;
          const name = cell.trim().replace(/\*$/g, '').trim();
          if (name.length >= 2 && !LOCATIONS.has(name)) names.add(name);
        }
      }

      const list = [...names].sort().map(n => ({ realName: n }));
      setUploadPreview(list);
      setUploadResult(null);
    } catch {
      alert('엑셀 파일을 읽을 수 없습니다');
    }
  }

  function startEdit(staff: any) {
    setEditId(staff.id);
    setIsAdding(false);
    setForm({
      realName: staff.real_name || '', kakaoName: staff.kakao_name || '',
      kakaoUserId: staff.kakao_user_id || '', kakaoRoomId: staff.kakao_room_id || '',
      email: staff.email || '', phone: staff.phone || '', department: staff.department || '', position: staff.position || '',
    });
  }

  function cancel() { setIsAdding(false); setEditId(null); setForm(emptyForm); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editId) updateMutation.mutate({ id: Number(editId), ...form });
    else createMutation.mutate(form);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const formError = createMutation.error || updateMutation.error;

  return (
    <div>
      {!isAdding && !editId && (
        <div className="mb-4 flex items-center justify-end gap-2">
          <label className="cursor-pointer">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              <Upload size={16} /> 엑셀 업로드
            </span>
          </label>
          <Button onClick={() => { setIsAdding(true); setEditId(null); setForm(emptyForm); }}>
            <UserPlus size={16} /> 직원 추가
          </Button>
        </div>
      )}

      {(isAdding || editId) && (
        <Card className="mb-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-sm font-semibold text-zinc-900">{editId ? '직원 정보 수정' : '새 직원 추가'}</h2>
            {formError && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{formError.message}</div>}
            <div className="grid grid-cols-2 gap-4">
              <FormField label="이름" required>
                <Input type="text" required value={form.realName} onChange={(e) => setForm({ ...form, realName: e.currentTarget.value })} placeholder="홍길동" />
              </FormField>
              <FormField label="카카오 이름" hint="카카오톡 프로필 이름과 일치해야 봇이 인식합니다">
                <Input type="text" value={form.kakaoName} onChange={(e) => setForm({ ...form, kakaoName: e.currentTarget.value })} placeholder="카카오톡 프로필 이름" />
              </FormField>
              <FormField label="카카오 개인톡방 ID" hint="에스컬레이션 알림을 받을 1:1 톡방명 (앱 로그에서 확인)">
                <Input type="text" value={form.kakaoRoomId} onChange={(e) => setForm({ ...form, kakaoRoomId: e.currentTarget.value })} placeholder="직원이름 (1:1 톡방명)" />
              </FormField>
              <FormField label="부서">
                <Input type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.currentTarget.value })} placeholder="마케팅팀" />
              </FormField>
              <FormField label="직책">
                <Input type="text" value={form.position} onChange={(e) => setForm({ ...form, position: e.currentTarget.value })} placeholder="대리" />
              </FormField>
              <FormField label="이메일">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.currentTarget.value })} placeholder="hong@example.com" />
              </FormField>
              <FormField label="전화번호">
                <Input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.currentTarget.value })} placeholder="010-1234-5678" />
              </FormField>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={isPending}>{isPending ? '저장 중...' : editId ? '수정' : '추가'}</Button>
              <Button type="button" onClick={cancel} variant="secondary"><X size={14} /> 취소</Button>
            </div>
          </form>
        </Card>
      )}

      {/* 엑셀 업로드 미리보기 */}
      {uploadPreview.length > 0 && (
        <Card className="mb-5 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-zinc-900">엑셀에서 {uploadPreview.length}명 감지됨 (기존 직원은 자동 건너뜁니다)</h3>
            <button onClick={() => setUploadPreview([])} className="text-xs text-zinc-400 hover:text-zinc-600">취소</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-y-auto">
            {uploadPreview.map((s, i) => (
              <Badge key={i} variant="outline">{s.realName}</Badge>
            ))}
          </div>
          <Button onClick={() => bulkImportMutation.mutate({ staffList: uploadPreview })}
            disabled={bulkImportMutation.isPending}>
            {bulkImportMutation.isPending ? '등록 중...' : `${uploadPreview.length}명 일괄 등록`}
          </Button>
        </Card>
      )}

      {/* 업로드 결과 */}
      {uploadResult && (
        <div className="mb-5 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-emerald-800">
              신규 등록 {uploadResult.imported}명 / 기존 건너뜀 {uploadResult.skipped}명
              {uploadResult.errors.length > 0 && ` / 오류 ${uploadResult.errors.length}건`}
            </span>
            <button onClick={() => setUploadResult(null)} className="text-emerald-400 hover:text-emerald-600">&times;</button>
          </div>
          {uploadResult.errors.length > 0 && (
            <ul className="mt-2 text-xs text-red-600">{uploadResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}

      <div className="mb-4 flex items-center gap-3">
        <Input type="text" value={search} onChange={(e) => setSearch(e.currentTarget.value)}
          placeholder="이름, 카카오이름, 부서로 검색..." className="flex-1" />
        <label className="flex items-center gap-1.5 text-sm text-zinc-500 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)}
            className="rounded border-zinc-300" />
          비활성 포함
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : !staffList?.length ? (
        <div className="flex flex-col items-center py-16 text-zinc-400">
          <p className="text-sm">등록된 직원이 없습니다</p>
          <button onClick={() => { setIsAdding(true); setForm(emptyForm); }} className="mt-2 text-sm text-blue-600 hover:underline">
            첫 직원을 추가해 보세요
          </button>
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-zinc-50">
                <th className="px-4 py-3 text-left font-medium text-zinc-600">이름</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-600">카카오</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-600">부서</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-600">직책</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-600">연락처</th>
                <th className="px-4 py-3 text-right font-medium text-zinc-600 w-32">작업</th>
              </tr>
            </thead>
            <tbody>
              {staffList.map((staff: any) => (
                <tr key={staff.id} className={`border-b last:border-0 hover:bg-zinc-50/50 transition-colors ${!staff.is_active ? 'opacity-40' : ''}`}>
                  <td className="px-4 py-3 font-medium text-zinc-900">{staff.real_name}</td>
                  <td className="px-4 py-3 text-zinc-500">{staff.kakao_name || '-'}</td>
                  <td className="px-4 py-3 text-zinc-600">{staff.department || '-'}</td>
                  <td className="px-4 py-3 text-zinc-600">{staff.position || '-'}</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{staff.phone || staff.email || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => startEdit(staff)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600">
                        <Pencil size={14} />
                      </button>
                      <Button size="sm" variant={staff.is_active ? 'ghost' : 'success'}
                        onClick={() => toggleMutation.mutate({ id: Number(staff.id), isActive: !staff.is_active })}
                        disabled={toggleMutation.isPending}
                        className={staff.is_active ? 'text-red-500 hover:bg-red-50 hover:text-red-600' : ''}>
                        {staff.is_active ? '비활성' : '활성화'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-xs text-zinc-400">
        총 {staffList?.length ?? 0}명{!showInactive && ' (활성 직원만 표시)'}
      </p>
    </div>
  );
}
