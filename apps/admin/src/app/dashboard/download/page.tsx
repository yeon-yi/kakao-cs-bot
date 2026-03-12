'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Smartphone, Shield, CheckCircle2, Clock, HardDrive, Tag } from 'lucide-react';

interface ApkInfo {
  version: string;
  updatedAt: string;
  fileSize: number;
  changelog: string;
  available: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${day} ${h}:${min}`;
}

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  return `${day}일 전`;
}

export default function DownloadPage() {
  const [info, setInfo] = useState<ApkInfo | null>(null);

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://1.234.83.118:3000';
    fetch(`${apiBase}/download/apk/info`)
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-[640px]">
      <div className="mb-6">
        <h1 className="text-lg font-bold text-[hsl(var(--foreground))]">앱 다운로드</h1>
        <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
          OpenPLAT Bot 안드로이드 앱을 설치하세요
        </p>
      </div>

      {/* App Info Card */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm mb-6">
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--sidebar-bg))]">
              <Smartphone size={24} className="text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold text-[hsl(var(--foreground))]">OpenPLAT Bot</h2>
              <p className="mt-0.5 text-sm text-[hsl(var(--muted))]">카카오톡 CS 자동 응답 봇</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-[hsl(var(--muted))]">
                <span>Android</span>
                <span className="text-[hsl(var(--border))]">|</span>
                <span className="flex items-center gap-1">
                  <Tag size={10} />
                  v{info?.version || '1.0.0'}
                </span>
                <span className="text-[hsl(var(--border))]">|</span>
                <span className="flex items-center gap-1">
                  <HardDrive size={10} />
                  {info ? formatFileSize(info.fileSize) : '약 25MB'}
                </span>
              </div>
            </div>
          </div>

          {/* 업데이트 정보 */}
          {info?.updatedAt && (
            <div className="mt-4 rounded-md bg-blue-50 border border-blue-100 px-4 py-2.5">
              <div className="flex items-center gap-2 text-xs text-blue-700">
                <Clock size={12} className="shrink-0" />
                <span className="font-medium">최근 업데이트:</span>
                <span>{formatDate(info.updatedAt)}</span>
                <span className="text-blue-400">({timeAgo(info.updatedAt)})</span>
              </div>
              {info.changelog && (
                <p className="mt-1.5 text-xs text-blue-600 pl-5 whitespace-pre-line">{info.changelog}</p>
              )}
            </div>
          )}

          <div className="mt-5">
            <a
              href="http://1.234.83.118:3000/download/apk"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button className="w-full" disabled={info?.available === false}>
                <Download size={15} />
                APK 다운로드
              </Button>
            </a>
          </div>
        </div>
      </div>

      {/* Requirements */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm mb-6">
        <div className="px-5 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">시스템 요구사항</h3>
        </div>
        <div className="p-5">
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              <span className="text-sm text-[hsl(var(--foreground))]">Android 8.0 (Oreo) 이상</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              <span className="text-sm text-[hsl(var(--foreground))]">카카오톡 앱 설치 필수</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              <span className="text-sm text-[hsl(var(--foreground))]">알림 접근 권한 허용 필요</span>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
              <span className="text-sm text-[hsl(var(--foreground))]">인터넷 연결 필수</span>
            </div>
          </div>
        </div>
      </div>

      {/* Installation Guide */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm">
        <div className="px-5 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">설치 방법</h3>
        </div>
        <div className="p-5">
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--primary))]">
                1
              </span>
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">APK 파일 다운로드</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
                  위의 다운로드 버튼을 눌러 APK 파일을 받습니다.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--primary))]">
                2
              </span>
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">출처를 알 수 없는 앱 허용</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
                  설정 &gt; 보안 &gt; &quot;출처를 알 수 없는 앱&quot;을 허용으로 변경합니다.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--primary))]">
                3
              </span>
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">APK 설치</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
                  다운로드된 APK 파일을 실행하여 앱을 설치합니다.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--primary))]">
                4
              </span>
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">알림 접근 권한 설정</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
                  앱 실행 후 안내에 따라 알림 접근 권한을 허용합니다. 카카오톡 메시지를 읽기 위해 필요합니다.
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--primary))]">
                5
              </span>
              <div>
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">서버 연결 확인</p>
                <p className="mt-0.5 text-xs text-[hsl(var(--muted))]">
                  대시보드의 &quot;연결 기기&quot; 페이지에서 기기가 온라인으로 표시되면 설정 완료입니다.
                </p>
              </div>
            </li>
          </ol>

          <div className="mt-5 rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
            <div className="flex items-start gap-2">
              <Shield size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                <strong>보안 안내:</strong> 이 앱은 Google Play에 등록되지 않은 사내 배포용 앱입니다.
                설치 시 보안 경고가 나타날 수 있으나 정상적인 앱이므로 &quot;그래도 설치&quot;를 선택하세요.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
