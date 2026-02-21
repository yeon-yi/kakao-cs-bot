'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Save, X, Check } from 'lucide-react';

interface SettingDef {
  key: string;
  label: string;
  category: string;
  sensitive: boolean;
  description: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  api_keys: 'API 키',
  ai: 'AI 설정',
  knowledge: '지식 검색',
  response: '응답 설정',
  integrations: '외부 연동',
};

const CATEGORY_ORDER = ['api_keys', 'ai', 'knowledge', 'response', 'integrations'];

export default function SettingsPage() {
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { data: definitions } = trpc.settings.definitions.useQuery();
  const { data: values, refetch: refetchValues } = trpc.settings.getAll.useQuery();
  const setMutation = trpc.settings.set.useMutation();

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

      <div className="space-y-8">
        {CATEGORY_ORDER.map(cat => {
          const items = groups[cat];
          if (!items?.length) return null;

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
