"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

interface User {
  id: number;
  username: string;
  displayName: string;
  role: string;
  branch: string;
  tutorialSeen?: boolean;
}

import { ROLE_LABELS, UPSELLING_ROLES, RENEWAL_ROLES } from '@/lib/constants';
import { isRenewalRole } from '@/lib/renewal-auth';

const UPSELL_ROLES: readonly string[] = UPSELLING_ROLES;
const RENEWAL_ROLE_LIST: readonly string[] = RENEWAL_ROLES;

// 아이콘 컴포넌트
const icons = {
  dashboard: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 3h6v8H3V3zm8 0h6v5h-6V3zm0 7h6v7h-6v-7zM3 13h6v4H3v-4z" fill="currentColor"/>
    </svg>
  ),
  company: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 2h12v16H4V2zm2 3v2h3V5H6zm5 0v2h3V5h-3zM6 9v2h3V9H6zm5 0v2h3V9h-3zM6 13v2h3v-2H6zm5 0v2h3v-2h-3z" fill="currentColor"/>
    </svg>
  ),
  logs: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 4h12v1.5H4V4zm0 3.5h12V9H4V7.5zm0 3.5h8v1.5H4V11zm0 3.5h10v1.5H4V14.5z" fill="currentColor"/>
    </svg>
  ),
  users: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 4a3 3 0 100 6 3 3 0 000-6zM4 15c0-2.67 5.33-4 6-4s6 1.33 6 4v1H4v-1z" fill="currentColor"/>
    </svg>
  ),
  crawler: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 2a6 6 0 110 12 6 6 0 010-12zm-1 3v4.5l3.5 2.1.75-1.23-2.75-1.64V7H9z" fill="currentColor"/>
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.5 2l-.35 2.14a5.97 5.97 0 00-1.64.95L4.5 4.27 3 6.73l1.67 1.32a6.06 6.06 0 000 1.9L3 11.27l1.5 2.46 2.01-.82c.48.4 1.03.72 1.64.95L8.5 16h3l.35-2.14a5.97 5.97 0 001.64-.95l2.01.82 1.5-2.46-1.67-1.32a6.06 6.06 0 000-1.9L17 6.73l-1.5-2.46-2.01.82a5.97 5.97 0 00-1.64-.95L11.5 2h-3zM10 7a2 2 0 110 4 2 2 0 010-4z" fill="currentColor"/>
    </svg>
  ),
  distribute: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 2v6m0 0l3-3m-3 3L7 5M3 10h4m0 0L5 7m2 3L5 13m13-3h-4m0 0l2-3m-2 3l2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
};

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  show: (role: string) => boolean;
}

// 영업팀 핵심 메뉴
const SALES_NAV_ITEMS: NavItem[] = [
  { label: "대시보드", href: "/dashboard", icon: icons.dashboard, show: () => true },
  { label: "업체 관리", href: "/companies", icon: icons.company, show: () => true },
];

// 업셀링팀 핵심 메뉴
const UPSELL_NAV_ITEMS: NavItem[] = [
  { label: "대시보드", href: "/upsell/dashboard", icon: icons.dashboard, show: () => true },
  { label: "업체 관리", href: "/upsell/companies", icon: icons.company, show: () => true },
  { label: "분배 현황", href: "/upsell/distribution-history", icon: icons.logs, show: () => true },
  { label: "전지사 업체", href: "/companies", icon: icons.company, show: () => true },
];

// 재계약팀 핵심 메뉴
const RENEWAL_NAV_ITEMS: NavItem[] = [
  { label: "대시보드", href: "/renewal/dashboard", icon: icons.dashboard, show: () => true },
  { label: "업체 관리", href: "/renewal/companies", icon: icons.company, show: () => true },
  { label: "전지사 업체", href: "/companies", icon: icons.company, show: () => true },
];

// 관리팀 메뉴 (admin, manager_team만)
const MGMT_NAV_ITEMS: NavItem[] = [
  { label: "업체 현황", href: "/mgmt-companies", icon: icons.company, show: (r) => r === "admin" || r === "manager_team" },
  { label: "솔루션 일괄등록", href: "/solution-bulk", icon: icons.company, show: (r) => r === "admin" || r === "manager_team" },
  { label: "진행요청 관리", href: "/solution-requests", icon: icons.company, show: (r) => r === "admin" || r === "manager_team" },
  { label: "솔루션 실적", href: "/solution-report", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" },
  { label: "홈전산", href: "/homejeonsan", icon: icons.company, show: (r) => r === "admin" || r === "manager_team" },
  { label: "크롤링 설정", href: "/crawler", icon: icons.crawler, show: (r) => r === "admin" || r === "manager_team" },
];

// 분석 메뉴 (admin, manager_team만)
const ANALYTICS_NAV_ITEMS: NavItem[] = [
  { label: "워크로드", href: "/analytics/workload", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" },
  { label: "품질(AS율)", href: "/analytics/quality", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" },
  { label: "만료 파이프라인", href: "/analytics/expiring", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" },
  { label: "이탈 분석", href: "/analytics/churn", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" },
  { label: "KPI", href: "/analytics/kpi", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" },
  { label: "알림 이력", href: "/analytics/notifications", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" },
];

// 공통 메뉴 (하단 배치)
const COMMON_NAV_ITEMS: NavItem[] = [
  { label: "성과 리포트", href: "/reports", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" || r === "branch_manager" || r === "manager" || r === "upselling_director" || r === "upselling_chief" },
  { label: "활동 내역", href: "/logs", icon: icons.logs, show: () => true },
  { label: "계정 관리", href: "/users", icon: icons.users, show: (r) => r === "admin" || r === "manager_team" || r === "branch_manager" || r === "upselling_director" || r === "upselling_chief" || r === "renewal_director" || r === "renewal_chief" },
  { label: "설정", href: "/settings", icon: icons.settings, show: () => true },
];

function NavLink({ item, pathname, accent }: { item: NavItem; pathname: string; accent: string }) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
  return (
    <Link
      href={item.href}
      style={{
        display: "flex", alignItems: "center", gap: "10px", padding: "10px 20px", margin: "1px 0",
        fontSize: "13.5px", fontWeight: isActive ? 600 : 400, color: isActive ? "#ffffff" : "#94a3b8",
        backgroundColor: isActive ? "#1e293b" : "transparent",
        borderLeft: isActive ? `3px solid ${accent}` : "3px solid transparent",
        textDecoration: "none", transition: "background-color 0.15s, color 0.15s", letterSpacing: "-0.01em",
      }}
      onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "#1e293b"; e.currentTarget.style.color = "#cbd5e1"; } }}
      onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.backgroundColor = "transparent"; e.currentTarget.style.color = "#94a3b8"; } }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", opacity: isActive ? 1 : 0.7 }}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{id:number; companyName:string; representative:string; branch:string}>>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.results || []);
        }
      } catch {
        setSearchResults([]);
      }
    }, 300);
  }, []);

  // Keyboard shortcut: `/` to focus search, Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
      if (e.key === 'Escape') setSearchOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => {
        if (!res.ok) throw new Error("Unauthorized");
        return res.json();
      })
      .then((data) => {
        setUser(data.user);
        setLoading(false);
        if (data.user && !data.user.tutorialSeen) setShowTutorial(true);
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  // 페이지 이동 시 사이드바 닫기
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } finally {
      router.replace("/login");
    }
  };

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "#f8fafc",
          color: "#64748b",
          fontSize: "14px",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "3px solid #e2e8f0",
              borderTop: "3px solid #2563eb",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 12px",
            }}
          />
          로딩중...
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const isUpsellUser = UPSELL_ROLES.includes(user.role);
  const isRenewalUser = isRenewalRole(user.role);
  const isAdmin = user.role === "admin";

  // 영업팀 메뉴 (영업 역할 + admin)
  const salesItems = (!isUpsellUser && !isRenewalUser || isAdmin)
    ? SALES_NAV_ITEMS.filter((item) => item.show(user.role))
    : [];

  // 업셀팀 메뉴 (업셀 역할 + admin)
  const upsellItems = (isUpsellUser || isAdmin)
    ? UPSELL_NAV_ITEMS.filter((item) => item.show(user.role))
    : [];

  // 재계약팀 메뉴 (재계약 역할 + admin)
  const renewalItems = (isRenewalUser || isAdmin)
    ? RENEWAL_NAV_ITEMS.filter((item) => item.show(user.role))
    : [];

  // 관리팀 메뉴
  const mgmtItems = MGMT_NAV_ITEMS.filter((item) => item.show(user.role));

  // 분석 메뉴
  const analyticsItems = ANALYTICS_NAV_ITEMS.filter((item) => item.show(user.role));

  // 공통 메뉴
  const commonItems = COMMON_NAV_ITEMS.filter((item) => item.show(user.role));

  const sidebarAccent = isRenewalUser ? "#ec4899" : isUpsellUser ? "#8b5cf6" : "#2563eb";

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      {/* 모바일 햄버거 메뉴 */}
      <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}
        style={{ position: 'fixed', top: 12, left: 12, zIndex: 998 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>

      {/* 모바일 오버레이 */}
      {sidebarOpen && <div className="layout-overlay" style={{ display: 'block' }} onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside
        className={`layout-sidebar${sidebarOpen ? ' open' : ''}`}
        style={{
          width: "240px",
          minWidth: "240px",
          height: "100vh",
          backgroundColor: "#0f172a",
          display: "flex",
          flexDirection: "column",
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif',
        }}
      >
        {/* Branding */}
        <div
          style={{
            padding: "20px 20px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "6px",
                backgroundColor: sidebarAccent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path d="M10 1 L17 9 L14 9 L14 17 L6 17 L6 9 L3 9 Z" fill="white"/>
              </svg>
            </div>
            <div>
              <div
                style={{
                  color: "#ffffff",
                  fontSize: "16px",
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                플랫폼
              </div>
              <div
                style={{
                  color: "#64748b",
                  fontSize: "11px",
                  marginTop: "3px",
                  letterSpacing: "0.02em",
                }}
              >
                {isRenewalUser ? "재계약 CRM" : isUpsellUser ? "업셀링 CRM" : "관리 CRM"}
              </div>
            </div>
          </div>
        </div>

        {/* Global Search */}
        <div style={{ padding: '8px 12px', position: 'relative' }}>
          <input
            id="global-search"
            placeholder="업체 검색"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              doSearch(e.target.value);
            }}
            onFocus={() => setSearchOpen(true)}
            style={{ width: '100%', padding: '8px 12px', fontSize: '12px', border: 'none', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.08)', color: '#e2e8f0', outline: 'none', boxSizing: 'border-box' }}
          />
          {searchOpen && searchResults.length > 0 && (
            <div style={{ position: 'absolute', left: 12, right: 12, top: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, zIndex: 100, maxHeight: 300, overflowY: 'auto' }}>
              {searchResults.map(r => (
                <div key={r.id} onClick={() => { router.push(`/companies/${r.id}`); setSearchOpen(false); setSearchQuery(''); setSearchResults([]); }}
                  style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: 13 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                  <div style={{ color: '#f1f5f9', fontWeight: 500 }}>{r.companyName}</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>{r.representative} · {r.branch || '-'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          {/* 영업팀 섹션 */}
          {salesItems.length > 0 && (
            <>
              {(salesItems.length > 0 && upsellItems.length > 0) && (
                <div style={{ padding: "4px 20px 8px", fontSize: "10.5px", fontWeight: 600, color: "#2563eb", letterSpacing: "0.05em" }}>
                  영업팀
                </div>
              )}
              {salesItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} accent="#2563eb" />)}
            </>
          )}

          {/* 업셀링팀 섹션 */}
          {upsellItems.length > 0 && (
            <>
              <div style={{ margin: salesItems.length > 0 ? "12px 20px 8px" : "0", borderTop: salesItems.length > 0 ? "1px solid rgba(255,255,255,0.08)" : "none" }} />
              {(salesItems.length > 0 && upsellItems.length > 0) && (
                <div style={{ padding: "4px 20px 8px", fontSize: "10.5px", fontWeight: 600, color: "#8b5cf6", letterSpacing: "0.05em" }}>
                  업셀링팀
                </div>
              )}
              {upsellItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} accent="#8b5cf6" />)}
            </>
          )}

          {/* 재계약팀 섹션 */}
          {renewalItems.length > 0 && (
            <>
              <div style={{ margin: (salesItems.length > 0 || upsellItems.length > 0) ? "12px 20px 8px" : "0", borderTop: (salesItems.length > 0 || upsellItems.length > 0) ? "1px solid rgba(255,255,255,0.08)" : "none" }} />
              {(salesItems.length > 0 || upsellItems.length > 0 || isAdmin) && (
                <div style={{ padding: "4px 20px 8px", fontSize: "10.5px", fontWeight: 600, color: "#ec4899", letterSpacing: "0.05em" }}>
                  재계약팀
                </div>
              )}
              {renewalItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} accent="#ec4899" />)}
            </>
          )}

          {/* 관리팀 섹션 */}
          {mgmtItems.length > 0 && (
            <>
              <div style={{ margin: "12px 20px 8px", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
              <div style={{ padding: "4px 20px 8px", fontSize: "10.5px", fontWeight: 600, color: "#f59e0b", letterSpacing: "0.05em" }}>
                관리팀
              </div>
              {mgmtItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} accent="#f59e0b" />)}
            </>
          )}

          {/* 분석 섹션 */}
          {analyticsItems.length > 0 && (
            <>
              <div style={{ margin: "4px 20px 8px", borderTop: "1px solid rgba(255,255,255,0.05)" }} />
              <div style={{ padding: "4px 20px 8px", fontSize: "10px", fontWeight: 600, color: "#22d3ee", letterSpacing: "0.05em" }}>
                분석
              </div>
              {analyticsItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} accent="#22d3ee" />)}
            </>
          )}

          {/* 공통 섹션 */}
          {commonItems.length > 0 && (
            <>
              <div style={{ margin: "12px 20px 8px", borderTop: "1px solid rgba(255,255,255,0.08)" }} />
              {commonItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} accent={sidebarAccent} />)}
            </>
          )}
        </nav>

        {/* User info + Logout */}
        <div
          style={{
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "16px 20px",
            flexShrink: 0,
          }}
        >
          <div style={{ marginBottom: "12px" }}>
            <div
              style={{
                color: "#e2e8f0",
                fontSize: "13px",
                fontWeight: 600,
                lineHeight: 1.4,
              }}
            >
              {user.displayName}
            </div>
            <div
              style={{
                color: "#64748b",
                fontSize: "11.5px",
                marginTop: "2px",
                lineHeight: 1.4,
              }}
            >
              {ROLE_LABELS[user.role] || user.role}
              {user.branch ? ` / ${user.branch}` : ""}
            </div>
          </div>
          <button
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              width: "100%",
              padding: "8px 12px",
              fontSize: "12.5px",
              color: "#94a3b8",
              backgroundColor: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              cursor: "pointer",
              transition: "background-color 0.15s, color 0.15s",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#1e293b";
              e.currentTarget.style.color = "#e2e8f0";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#94a3b8";
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M6 2H3v12h3m4-6h5m0 0l-2.5-2.5M12 8l-2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="square"
              />
            </svg>
            로그아웃
          </button>
        </div>
      </aside>

      {/* Content area */}
      <main
        className="crm-main"
        style={{
          flex: 1,
          overflowY: "auto",
          backgroundColor: "#f8fafc",
          minHeight: "100vh",
        }}
      >
        {children}
      </main>

      {/* 최초 로그인 튜토리얼 */}
      {showTutorial && user && (
        <TutorialModal role={user.role} onClose={async () => {
          setShowTutorial(false);
          try { await fetch('/api/auth', { method: 'PATCH', credentials: 'include' }); } catch { /* */ }
        }} />
      )}
    </div>
  );
}

// ── 튜토리얼 모달 ──────────────────────────────────────────
const TUTORIAL_CONTENT: Record<string, { title: string; steps: string[] }> = {
  staff: {
    title: '영업팀 사용 가이드',
    steps: [
      '업체 관리: 본인 담당 업체 목록을 확인하고 상세 정보를 조회합니다.',
      '솔루션 설정: 업체 상세에서 계약기간, 블로그/인스타 목표, 홈페이지, SEO, 영상을 설정합니다.',
      '플레이스 고유번호: 네이버 플레이스 번호를 입력하고 "업장 확인"으로 검증합니다.',
      '홈전산 등록: Step 2에서 키워드, Step 3에서 리포트를 등록합니다.',
      '진행요청: Step 4에서 매월 블로그/인스타 진행을 관리팀에 요청합니다 (월 1회).',
      '홀딩: 업체 홀딩을 걸거나 기간을 지정하여 자동 해제할 수 있습니다.',
      'AS요청: 완료된 건에 문제가 있으면 사유와 함께 AS를 요청합니다.',
    ],
  },
  manager: {
    title: '간부 사용 가이드',
    steps: [
      '업체 관리: 본인 지사의 업체를 관리합니다.',
      '솔루션 설정: 업체별 솔루션을 설정하고 진행 상태를 확인합니다.',
      '진행요청: 매월 솔루션 진행을 관리팀에 요청합니다.',
      '대시보드: 지사 전체 현황을 한눈에 확인합니다.',
    ],
  },
  branch_manager: {
    title: '지사장 사용 가이드',
    steps: [
      '업체 관리: 본인 지사의 전체 업체를 조회하고 관리합니다.',
      '솔루션 설정: 업체별 솔루션을 설정하고 진행 상태를 확인합니다.',
      '대시보드: 지사 성과를 한눈에 파악합니다.',
    ],
  },
  manager_team: {
    title: '관리팀 사용 가이드',
    steps: [
      '업체 현황: 월별로 팀에 배정된 지사의 업체 솔루션 진행 현황을 확인합니다.',
      '진행요청 관리: 영업팀의 솔루션 요청을 접수, 완료, 반려합니다.',
      '솔루션 일괄등록: 엑셀 파일로 블로그/인스타 건수를 일괄 업데이트합니다.',
      '솔루션 실적: 담당자별, 지사별, 기간별로 솔루션 실적을 상세 조회합니다.',
      '홈전산: 키워드/리포트를 개별 또는 엑셀 일괄로 등록합니다.',
      '홀딩 업체: 기본 숨김, "홀딩 포함" 체크로 확인 가능합니다.',
      '카테고리/내 담당: 본인 책임 솔루션 타입으로 필터링할 수 있습니다.',
    ],
  },
  admin: {
    title: '관리자 사용 가이드',
    steps: [
      '전체 관리: 모든 지사, 모든 역할의 데이터에 접근할 수 있습니다.',
      '계정 관리: 사용자 생성, 역할 변경, 비밀번호 초기화를 수행합니다.',
      '설정: 관리팀 팀-지사 월별 매핑, 홈전산 계정을 설정합니다.',
      '크롤링: payment.nldb.co.kr에서 업체 데이터를 자동 수집합니다.',
      '업체 삭제: 업체 상세에서 삭제 시 관련 데이터가 모두 제거됩니다.',
    ],
  },
};

function TutorialModal({ role, onClose }: { role: string; onClose: () => void }) {
  const [step, setStep] = useState(0);

  // 역할에 맞는 콘텐츠 (없으면 기본)
  const content = TUTORIAL_CONTENT[role] || TUTORIAL_CONTENT.staff || { title: '사용 가이드', steps: ['시스템에 오신 것을 환영합니다.'] };
  const total = content.steps.length;
  const isLast = step >= total - 1;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
      <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '32px', width: '480px', maxWidth: '90vw', boxShadow: '0 25px 60px rgba(0,0,0,0.2)' }}>
        {/* 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: 0 }}>{content.title}</h2>
          <span style={{ fontSize: '13px', color: '#94a3b8' }}>{step + 1} / {total}</span>
        </div>

        {/* 프로그레스 바 */}
        <div style={{ width: '100%', height: '4px', backgroundColor: '#f1f5f9', borderRadius: '2px', marginBottom: '24px' }}>
          <div style={{ width: `${((step + 1) / total) * 100}%`, height: '100%', backgroundColor: '#2563eb', borderRadius: '2px', transition: 'width 0.3s' }} />
        </div>

        {/* 내용 */}
        <div style={{ minHeight: '80px', display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: '15px', color: '#334155', lineHeight: 1.7 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', borderRadius: '50%', backgroundColor: '#2563eb', color: '#fff', fontSize: '12px', fontWeight: 700, marginRight: '10px', flexShrink: 0 }}>
              {step + 1}
            </span>
            {content.steps[step]}
          </div>
        </div>

        {/* 버튼 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '28px' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', fontSize: '13px', color: '#64748b', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            건너뛰기
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {step > 0 && (
              <button onClick={() => setStep(step - 1)} style={{ padding: '10px 20px', fontSize: '13px', fontWeight: 500, color: '#475569', backgroundColor: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit' }}>
                이전
              </button>
            )}
            <button onClick={() => isLast ? onClose() : setStep(step + 1)} style={{ padding: '10px 24px', fontSize: '13px', fontWeight: 600, color: '#fff', backgroundColor: '#2563eb', border: 'none', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit' }}>
              {isLast ? '시작하기' : '다음'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
