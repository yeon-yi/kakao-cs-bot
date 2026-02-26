'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Save, X, Check, Power, ShieldAlert, FlaskConical, Clock } from 'lucide-react';

interface SettingDef {
  key: string;
  label: string;
  category: string;
  sensitive: boolean;
  description: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  bot_control: '봇 제어',
  api_keys: 'API 키',
  ai: 'AI 설정',
  ai_chain: 'AI 멀티모델 체인',
  knowledge: '지식 검색',
  response: '응답 설정',
  integrations: '외부 연동',
};

const CATEGORY_ORDER = ['bot_control', 'api_keys', 'ai', 'ai_chain', 'knowledge', 'response', 'integrations'];

export default function SettingsPage() {
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [toggling, setToggling] = useState(false);

  const { data: definitions } = trpc.settings.definitions.useQuery();
  const { data: values, refetch: refetchValues } = trpc.settings.getAll.useQuery();
  const setMutation = trpc.settings.set.useMutation();

  const botMode = (values?.['bot.mode']?.value || 'off').trim();
  const testRooms = (values?.['bot.test_rooms']?.value || '').trim();

  async function handleModeChange(newMode: string) {
    if (newMode === 'on') {
      if (!confirm('봇을 전체 활성화하시겠습니까?\n\n운영시간 내 모든 고객 메시지에 자동 응답합니다.\n학습과 테스트가 충분히 완료되었는지 확인하세요.')) return;
    }
    setToggling(true);
    try {
      await setMutation.mutateAsync({ key: 'bot.mode', value: newMode });
      await refetchValues();
    } catch (err: any) {
      alert('변경 실패: ' + err.message);
    } finally {
      setToggling(false);
    }
  }

  function groupByCategory(defs: SettingDef[]) {
    const groups: Record<string, SettingDef[]> = {};
    for (const d of defs) {
      if (!groups[d.category]) groups[d.category] = [];
      groups[d.category].push(d);
    }
    return groups;
  }

  function getCurrentValue(key: string): string {
    if (editValues[key] !== undefined) return editValues[key];
    return values?.[key]?.value ?? '';
  }

  function isMasked(key: string): boolean {
    return !!(values?.[key]?.masked && editValues[key] === undefined);
  }

  async function handleSave(key: string) {
    const val = editValues[key];
    if (val === undefined) return;

    setSaving(key);
    try {
      await setMutation.mutateAsync({ key, value: val });
      setSaved(key);
      setEditValues(prev => { const next = { ...prev }; delete next[key]; return next; });
      await refetchValues();
      setTimeout(() => setSaved(null), 2000);
    } catch (err: any) {
      alert('저장 실패: ' + err.message);
    } finally {
      setSaving(null);
    }
  }

  if (!definitions) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  const groups = groupByCategory(definitions);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">일반 설정</h1>
        <p className="text-sm text-zinc-500 mt-1">
          API 키, AI 모델, 검색 설정 등을 관리합니다. 변경사항은 즉시 서버에 반영됩니다.
        </p>
      </div>

      {/* 봇 모드 제어 (최상단) */}
      <Card className={`p-5 mb-8 border-2 ${
        botMode === 'on' ? 'border-emerald-300 bg-emerald-50/30'
          : botMode === 'test' ? 'border-amber-300 bg-amber-50/30'
          : 'border-red-200 bg-red-50/30'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {botMode === 'on' && <Power size={24} className="text-emerald-600" />}
            {botMode === 'test' && <FlaskConical size={24} className="text-amber-600" />}
            {botMode === 'off' && <ShieldAlert size={24} className="text-red-500" />}
            <div>
              <p className="text-base font-semibold text-zinc-900">
                {botMode === 'on' ? '운영중' : botMode === 'test' ? '테스트 모드' : '봇 꺼짐'}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {botMode === 'on' && '운영시간 내 모든 고객 메시지에 자동 응답합니다'}
                {botMode === 'test' && '지정된 테스트 방에서만 봇이 응답합니다'}
                {botMode === 'off' && '모든 메시지를 무시합니다'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => handleModeChange('off')} disabled={toggling || botMode === 'off'}
            variant={botMode === 'off' ? 'default' : 'secondary'} size="sm"
            className={botMode === 'off' ? 'ring-2 ring-red-300' : ''}>
            <ShieldAlert size={14} /> OFF
          </Button>
          <Button onClick={() => handleModeChange('test')} disabled={toggling || botMode === 'test'}
            variant={botMode === 'test' ? 'default' : 'secondary'} size="sm"
            className={botMode === 'test' ? 'ring-2 ring-amber-300 bg-amber-500 hover:bg-amber-600 text-white' : ''}>
            <FlaskConical size={14} /> 테스트
          </Button>
          <Button onClick={() => handleModeChange('on')} disabled={toggling || botMode === 'on'}
            variant={botMode === 'on' ? 'default' : 'secondary'} size="sm"
            className={botMode === 'on' ? 'ring-2 ring-emerald-300 bg-emerald-500 hover:bg-emerald-600 text-white' : ''}>
            <Power size={14} /> 운영
          </Button>
        </div>
        {botMode === 'test' && (
          <div className="mt-4 pt-3 border-t border-amber-200/50">
            <p className="text-xs font-medium text-amber-700 mb-2">테스트 방 목록</p>
            <p className="text-[11px] text-amber-600/70 mb-2">아래 방에서만 봇이 응답합니다. 쉼표로 구분하세요. 테스트 모드는 운영시간 제한 없이 24시간 작동합니다.</p>
            <div className="flex gap-2 items-center">
              <Input
                value={editValues['bot.test_rooms'] ?? testRooms}
                onChange={(e) => { const v = e.currentTarget.value; setEditValues(prev => ({ ...prev, 'bot.test_rooms': v })); }}
                placeholder="방이름1, 방이름2, ..."
                className="flex-1 text-xs font-mono"
              />
              {editValues['bot.test_rooms'] !== undefined && (
                <>
                  <Button onClick={() => handleSave('bot.test_rooms')} disabled={saving === 'bot.test_rooms'} size="sm">
                    <Save size={14} /> 저장
                  </Button>
                  <Button onClick={() => setEditValues(prev => { const next = { ...prev }; delete next['bot.test_rooms']; return next; })}
                    variant="secondary" size="sm">
                    <X size={14} />
                  </Button>
                </>
              )}
            </div>
            {testRooms && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {testRooms.split(',').map((r: string) => r.trim()).filter(Boolean).map((room: string) => (
                  <Badge key={room} variant="outline" className="text-[10px] font-mono">{room}</Badge>
                ))}
              </div>
            )}
          </div>
        )}
        {/* 운영시간 설정 */}
        <div className="mt-4 pt-3 border-t border-zinc-200/50">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-zinc-500" />
            <p className="text-xs font-medium text-zinc-700">운영 시간</p>
            {botMode === 'test' && <Badge variant="outline" className="text-[10px]">테스트 모드: 24시간</Badge>}
          </div>
          <div className="flex gap-3 items-center">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">시작</span>
              <Input
                type="time"
                value={editValues['operation.start_time'] ?? (values?.['operation.start_time']?.value || '09:50')}
                onChange={(e) => { const v = e.currentTarget.value; setEditValues(prev => ({ ...prev, 'operation.start_time': v })); }}
                className="w-28 text-xs font-mono"
              />
            </div>
            <span className="text-zinc-400">~</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500">종료</span>
              <Input
                type="time"
                value={editValues['operation.end_time'] ?? (values?.['operation.end_time']?.value || '18:30')}
                onChange={(e) => { const v = e.currentTarget.value; setEditValues(prev => ({ ...prev, 'operation.end_time': v })); }}
                className="w-28 text-xs font-mono"
              />
            </div>
            {(editValues['operation.start_time'] !== undefined || editValues['operation.end_time'] !== undefined) && (
              <>
                <Button onClick={async () => {
                  if (editValues['operation.start_time'] !== undefined) await handleSave('operation.start_time');
                  if (editValues['operation.end_time'] !== undefined) await handleSave('operation.end_time');
                }} disabled={saving === 'operation.start_time' || saving === 'operation.end_time'} size="sm">
                  <Save size={14} /> 저장
                </Button>
                <Button onClick={() => setEditValues(prev => {
                  const next = { ...prev };
                  delete next['operation.start_time'];
                  delete next['operation.end_time'];
                  return next;
                })} variant="secondary" size="sm">
                  <X size={14} />
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-8">
        {CATEGORY_ORDER.map(cat => {
          const items = groups[cat];
          if (!items?.length) return null;
          // bot_control은 위에서 토글로 처리했으므로 스킵
          if (cat === 'bot_control') return null;

          return (
            <section key={cat}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3 pb-2 border-b border-zinc-100">
                {CATEGORY_LABELS[cat] || cat}
              </h2>
              <div className="space-y-3">
                {items.map(def => {
                  const currentVal = getCurrentValue(def.key);
                  const masked = isMasked(def.key);
                  const isEditing = editValues[def.key] !== undefined;
                  const isSaving = saving === def.key;
                  const justSaved = saved === def.key;

                  return (
                    <Card key={def.key} className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-sm font-medium text-zinc-900">{def.label}</p>
                          <p className="text-xs text-zinc-400 mt-0.5">{def.description}</p>
                        </div>
                        {def.sensitive && <Badge variant="warning">민감</Badge>}
                      </div>
                      <div className="flex gap-2 items-center">
                        <Input
                          type={def.sensitive && !isEditing ? 'password' : 'text'}
                          value={currentVal}
                          onChange={(e) => { const v = e.currentTarget.value; setEditValues(prev => ({ ...prev, [def.key]: v })); }}
                          onFocus={() => { if (masked && editValues[def.key] === undefined) setEditValues(prev => ({ ...prev, [def.key]: '' })); }}
                          placeholder={masked ? '(저장됨 - 클릭하여 변경)' : '값을 입력하세요'}
                          disabled={isSaving}
                          className="flex-1 font-mono text-xs"
                        />
                        {isEditing && (
                          <>
                            <Button onClick={() => handleSave(def.key)} disabled={isSaving} size="sm">
                              <Save size={14} /> {isSaving ? '...' : '저장'}
                            </Button>
                            <Button onClick={() => setEditValues(prev => { const next = { ...prev }; delete next[def.key]; return next; })}
                              variant="secondary" size="sm">
                              <X size={14} />
                            </Button>
                          </>
                        )}
                        {justSaved && (
                          <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                            <Check size={14} /> 저장됨
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-300 mt-1.5 font-mono">{def.key}</p>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
