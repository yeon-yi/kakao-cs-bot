"use client";

import React, { useState, useEffect, useCallback } from "react";

interface CompanyRow {
  id: number;
  companyName: string;
  representative: string;
  branch: string;
  staffName: string;
  managerName: string;
  paymentDate: string;
  blog: string;
  insta: string;
  homepage: string;
  video: string;
}

type SolutionFilter = "all" | "blog_incomplete" | "insta_incomplete" | "homepage_incomplete" | "video_incomplete";

const SOLUTION_FILTERS: { value: SolutionFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "blog_incomplete", label: "블로그 미완료" },
  { value: "insta_incomplete", label: "인스타 미완료" },
  { value: "homepage_incomplete", label: "홈페이지 미완료" },
  { value: "video_incomplete", label: "영상 미완료" },
];

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function MgmtCompaniesPage() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [solution, setSolution] = useState<SolutionFilter>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);

  const [userTeam, setUserTeam] = useState<string | null>(null);
  const [isLeader, setIsLeader] = useState(false);
  const [teamFilter, setTeamFilter] = useState<string>("");

  // Fetch user info on mount
  useEffect(() => {
    fetch("/api/auth", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const team = d.user?.mgmtTeam || null;
        const position = d.user?.mgmtPosition || null;
        const role = d.user?.role || "";
        setUserTeam(team);
        const leader =
          position === "director" ||
          position === "deputy" ||
          position === "sp" ||
          role === "admin";
        setIsLeader(leader);
        if (!leader && team) {
          setTeamFilter(team);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch available months
  useEffect(() => {
    fetch(`/api/settings/mgmt-teams?yearMonth=${yearMonth}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setAvailableMonths(d.availableMonths || []);
      })
      .catch(() => {});
  }, [yearMonth]);

  // Fetch companies
  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        yearMonth,
        solution,
        search,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (teamFilter) params.set("team", teamFilter);

      const res = await fetch(`/api/mgmt/companies?${params.toString()}`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 0);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [yearMonth, solution, search, page, pageSize, teamFilter]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [yearMonth, solution, search, teamFilter]);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif';

  const thStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#475569",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: "13px",
    color: "#0f172a",
    borderBottom: "1px solid #f1f5f9",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1400px", margin: "0 auto", fontFamily: fontStack }}>
      {/* Header */}
      <div style={{ marginBottom: "20px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
          업체 현황
        </h1>
        <p style={{ fontSize: "13.5px", color: "#64748b", marginTop: "6px", marginBottom: 0 }}>
          관리팀 소속 지사의 업체 및 솔루션 진행 현황을 확인합니다.
        </p>
      </div>

      {/* Filters */}
      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: "16px 20px",
          marginBottom: "16px",
          display: "flex",
          flexWrap: "wrap",
          gap: "12px",
          alignItems: "flex-end",
        }}
      >
        {/* Month */}
        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
            대상 월
          </label>
          <select
            value={yearMonth}
            onChange={(e) => setYearMonth(e.target.value)}
            style={{
              height: 36,
              padding: "0 10px",
              fontSize: 13,
              border: "1px solid #e2e8f0",
              background: "#fff",
              outline: "none",
              cursor: "pointer",
            }}
          >
            {(() => {
              const curYM = currentYearMonth();
              const now = new Date();
              const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
              const nextYM = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
              const allMonths = [...new Set([...availableMonths, curYM, nextYM])].sort().reverse();
              return allMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ));
            })()}
          </select>
        </div>

        {/* Team filter (leaders only) */}
        {isLeader && (
          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              팀
            </label>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              style={{
                height: 36,
                padding: "0 10px",
                fontSize: 13,
                border: "1px solid #e2e8f0",
                background: "#fff",
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="">전체</option>
              <option value="1">1팀</option>
              <option value="2">2팀</option>
            </select>
          </div>
        )}

        {/* Solution filter */}
        <div>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
            솔루션 상태
          </label>
          <select
            value={solution}
            onChange={(e) => setSolution(e.target.value as SolutionFilter)}
            style={{
              height: 36,
              padding: "0 10px",
              fontSize: 13,
              border: "1px solid #e2e8f0",
              background: "#fff",
              outline: "none",
              cursor: "pointer",
            }}
          >
            {SOLUTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div style={{ flex: "1 1 200px" }}>
          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: 4 }}>
            업체명 검색
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearch(searchInput);
              }}
              placeholder="업체명으로 검색..."
              style={{
                flex: 1,
                height: 36,
                padding: "0 10px",
                fontSize: 13,
                border: "1px solid #e2e8f0",
                outline: "none",
              }}
            />
            <button
              onClick={() => setSearch(searchInput)}
              style={{
                height: 36,
                padding: "0 14px",
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                backgroundColor: "#f59e0b",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              검색
            </button>
            {search && (
              <button
                onClick={() => {
                  setSearch("");
                  setSearchInput("");
                }}
                style={{
                  height: 36,
                  padding: "0 12px",
                  fontSize: 13,
                  color: "#475569",
                  backgroundColor: "#fff",
                  border: "1px solid #e2e8f0",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
          padding: "0 2px",
        }}
      >
        <div style={{ fontSize: "13px", color: "#475569" }}>
          총 <b>{total}</b>건
          {userTeam && !isLeader && (
            <span style={{ marginLeft: 8, color: "#f59e0b", fontWeight: 600 }}>{userTeam}팀</span>
          )}
        </div>
        {loading && (
          <span style={{ fontSize: "12px", color: "#94a3b8" }}>로딩중...</span>
        )}
      </div>

      {/* Table */}
      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          overflow: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 50, textAlign: "center" }}>#</th>
              <th style={thStyle}>업체명</th>
              <th style={thStyle}>대표자</th>
              <th style={thStyle}>지사</th>
              <th style={thStyle}>담당자</th>
              <th style={thStyle}>간부</th>
              <th style={{ ...thStyle, textAlign: "center" }}>블로그</th>
              <th style={{ ...thStyle, textAlign: "center" }}>인스타</th>
              <th style={{ ...thStyle, textAlign: "center" }}>홈페이지</th>
              <th style={{ ...thStyle, textAlign: "center" }}>영상</th>
            </tr>
          </thead>
          <tbody>
            {companies.length === 0 && !loading ? (
              <tr>
                <td
                  colSpan={10}
                  style={{
                    padding: "40px 0",
                    textAlign: "center",
                    color: "#94a3b8",
                    fontSize: 13,
                  }}
                >
                  {total === 0 ? "해당 조건의 업체가 없습니다." : "데이터를 불러오는 중..."}
                </td>
              </tr>
            ) : (
              companies.map((c, i) => (
                <tr
                  key={c.id}
                  style={{ transition: "background-color 0.1s" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#fafafa";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "";
                  }}
                >
                  <td style={{ ...tdStyle, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>
                    {(page - 1) * pageSize + i + 1}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{c.companyName}</td>
                  <td style={tdStyle}>{c.representative}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 4,
                        backgroundColor: "#fffbeb",
                        color: "#d97706",
                        border: "1px solid #fde68a",
                      }}
                    >
                      {c.branch || "-"}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: "#475569" }}>{c.staffName || "-"}</td>
                  <td style={{ ...tdStyle, color: "#475569" }}>{c.managerName || "-"}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <SolutionBadge value={c.blog} type="count" />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <SolutionBadge value={c.insta} type="count" />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <SolutionBadge value={c.homepage} type="ox" />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <SolutionBadge value={c.video} type="ox" />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 4,
            marginTop: 16,
          }}
        >
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            style={{
              height: 32,
              padding: "0 12px",
              fontSize: 13,
              border: "1px solid #e2e8f0",
              background: "#fff",
              cursor: page <= 1 ? "not-allowed" : "pointer",
              opacity: page <= 1 ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            이전
          </button>
          <span style={{ fontSize: 13, color: "#475569", padding: "0 8px" }}>
            {page} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            style={{
              height: 32,
              padding: "0 12px",
              fontSize: 13,
              border: "1px solid #e2e8f0",
              background: "#fff",
              cursor: page >= totalPages ? "not-allowed" : "pointer",
              opacity: page >= totalPages ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

// Solution badge component
function SolutionBadge({ value, type }: { value: string; type: "count" | "ox" }) {
  if (value === "-") {
    return <span style={{ color: "#cbd5e1", fontSize: 12 }}>-</span>;
  }

  if (type === "ox") {
    const done = value === "O";
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 4,
          backgroundColor: done ? "#f0fdf4" : "#fef2f2",
          color: done ? "#16a34a" : "#dc2626",
          border: done ? "1px solid #bbf7d0" : "1px solid #fecaca",
        }}
      >
        {done ? "완료" : "미완료"}
      </span>
    );
  }

  // Count type: "3/180"
  const parts = value.split("/");
  if (parts.length === 2) {
    const current = parseInt(parts[0], 10);
    const target = parseInt(parts[1], 10);
    if (target === 0) return <span style={{ color: "#cbd5e1", fontSize: 12 }}>-</span>;
    const done = current >= target;
    return (
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: done ? "#16a34a" : "#d97706",
        }}
      >
        {value}
      </span>
    );
  }

  return <span style={{ fontSize: 12 }}>{value}</span>;
}
