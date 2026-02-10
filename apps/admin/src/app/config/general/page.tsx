'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

interface SettingDef {
  key: string;
  label: string;
  category: string;
  sensitive: boolean;
  description: string;
}

interface SettingValue {
  value: string;
  masked: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  api_keys: 'API Keys',
  ai: 'AI Settings',
  knowledge: 'Knowledge Base',
  response: 'Response',
  integrations: 'Integrations',
};

const CATEGORY_ORDER = ['api_keys', 'ai', 'knowledge', 'response', 'integrations'];

export default function SettingsPage() {
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const { data: definitions } = trpc.settings.definitions.useQuery();
  const { data: values, refetch: refetchValues } = trpc.settings.getAll.useQuery();
  const setMutation = trpc.settings.set.useMutation();

  // 카테고리별로 그룹핑
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
    if (values?.[key]) return values[key].value;
    return '';
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
      setEditValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await refetchValues();
      setTimeout(() => setSaved(null), 2000);
    } catch (err: any) {
      alert('저장 실패: ' + err.message);
    } finally {
      setSaving(null);
    }
  }

  function handleChange(key: string, value: string) {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleCancel(key: string) {
    setEditValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  if (!definitions) {
    return <p className="text-zinc-500">로딩 중...</p>;
  }

  const groups = groupByCategory(definitions);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-zinc-500 text-sm mb-8">API 키, AI 모델, 검색 설정 등을 관리합니다. 민감한 값은 마스킹되어 표시됩니다.</p>

      <div className="space-y-10">
        {CATEGORY_ORDER.map((cat) => {
          const items = groups[cat];
          if (!items || items.length === 0) return null;

          return (
            <section key={cat}>
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4 pb-2 border-b border-zinc-200">
                {CATEGORY_LABELS[cat] || cat}
              </h2>

              <div className="space-y-4">
                {items.map((def) => {
                  const currentVal = getCurrentValue(def.key);
                  const masked = isMasked(def.key);
                  const isEditing = editValues[def.key] !== undefined;
                  const isSaving = saving === def.key;
                  const justSaved = saved === def.key;

                  return (
                    <div key={def.key} className="border rounded-lg p-4 bg-white">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm text-zinc-900">{def.label}</p>
                          <p className="text-xs text-zinc-400 mt-0.5">{def.description}</p>
                        </div>
                        {def.sensitive && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded font-medium">
                            SENSITIVE
                          </span>
                        )}
                      </div>

                      <div className="flex gap-2 items-center">
                        <input
                          type={def.sensitive && !isEditing ? 'password' : 'text'}
                          value={currentVal}
                          onChange={(e) => handleChange(def.key, e.currentTarget.value)}
                          onFocus={() => {
                            if (masked && editValues[def.key] === undefined) {
                              handleChange(def.key, '');
                            }
                          }}
                          placeholder={masked ? '(저장됨 - 클릭하여 변경)' : '값을 입력하세요'}
                          className="flex-1 px-3 py-2 border rounded text-sm font-mono bg-zinc-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-300"
                          disabled={isSaving}
                        />

                        {isEditing && (
                          <>
                            <button
                              onClick={() => handleSave(def.key)}
                              disabled={isSaving}
                              className="px-3 py-2 bg-zinc-900 text-white text-xs rounded hover:bg-zinc-700 disabled:bg-zinc-300 font-medium"
                            >
                              {isSaving ? '...' : 'Save'}
                            </button>
                            <button
                              onClick={() => handleCancel(def.key)}
                              className="px-3 py-2 bg-zinc-100 text-zinc-600 text-xs rounded hover:bg-zinc-200 font-medium"
                            >
                              Cancel
                            </button>
                          </>
                        )}

                        {justSaved && (
                          <span className="text-xs text-green-600 font-medium">Saved</span>
                        )}
                      </div>

                      <p className="text-[10px] text-zinc-300 mt-1.5 font-mono">{def.key}</p>
                    </div>
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
