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
}

import { ROLE_LABELS, UPSELLING_ROLES } from '@/lib/constants';

const UPSELL_ROLES: readonly string[] = UPSELLING_ROLES;

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

// 관리팀 메뉴 (admin, manager_team만)
const MGMT_NAV_ITEMS: NavItem[] = [
  { label: "업체 현황", href: "/mgmt-companies", icon: icons.company, show: (r) => r === "admin" || r === "manager_team" },
  { label: "솔루션 일괄등록", href: "/solution-bulk", icon: icons.company, show: (r) => r === "admin" || r === "manager_team" },
  { label: "홈전산", href: "/homejeonsan", icon: icons.company, show: (r) => r === "admin" || r === "manager_team" },
  { label: "크롤링 설정", href: "/crawler", icon: icons.crawler, show: (r) => r === "admin" || r === "manager_team" },
];

// 공통 메뉴 (하단 배치)
const COMMON_NAV_ITEMS: NavItem[] = [
  { label: "성과 리포트", href: "/reports", icon: icons.logs, show: (r) => r === "admin" || r === "manager_team" || r === "branch_manager" || r === "manager" || r === "upselling_director" || r === "upselling_chief" },
  { label: "활동 내역", href: "/logs", icon: icons.logs, show: () => true },
  { label: "계정 관리", href: "/users", icon: icons.users, show: (r) => r === "admin" || r === "manager_team" || r === "upselling_director" || r === "upselling_chief" },
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
  const isAdmin = user.role === "admin";

  // 영업팀 메뉴 (영업 역할 + admin)
  const salesItems = (!isUpsellUser || isAdmin)
    ? SALES_NAV_ITEMS.filter((item) => item.show(user.role))
    : [];

  // 업셀팀 메뉴 (업셀 역할 + admin)
  const upsellItems = (isUpsellUser || isAdmin)
    ? UPSELL_NAV_ITEMS.filter((item) => item.show(user.role))
    : [];

  // 관리팀 메뉴
  const mgmtItems = MGMT_NAV_ITEMS.filter((item) => item.show(user.role));

  // 공통 메뉴
  const commonItems = COMMON_NAV_ITEMS.filter((item) => item.show(user.role));

  const sidebarAccent = isUpsellUser ? "#8b5cf6" : "#2563eb";

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
                {isUpsellUser ? "업셀링 CRM" : "관리 CRM"}
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
    </div>
  );
}
