"use client";

import {
  useState,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { styles } from "./styles";
import type { LogEntry } from "./types";

export interface LogSectionRef {
  fetchLogs: () => void;
}

const LOG_PAGE_SIZE = 20;

const TYPE_LABEL_MAP: Record<string, string> = {
  keyword: "키워드",
  report: "리포트",
  blog: "블로그",
  insta: "인스타",
  homepage: "홈페이지",
  video: "영상",
  seo: "SEO",
};

const BRANCH_OPTIONS = ["전체", "인천", "수원", "동탄", "용인", "부산", "본사"];

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: "전체", value: "" },
  { label: "성공", value: "success" },
  { label: "실패", value: "failed" },
];

const TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: "전체", value: "" },
  { label: "키워드", value: "keyword" },
  { label: "리포트", value: "report" },
  { label: "블로그", value: "blog" },
  { label: "인스타", value: "insta" },
  { label: "홈페이지", value: "homepage" },
  { label: "영상", value: "video" },
  { label: "SEO", value: "seo" },
];

const filterInputStyle: React.CSSProperties = {
  height: "30px",
  fontSize: "12px",
  padding: "0 8px",
  border: "1px solid #e2e8f0",
  borderRadius: "4px",
  outline: "none",
  backgroundColor: "#fff",
  color: "#0f172a",
  fontFamily: "inherit",
};

const LogSection = forwardRef<LogSectionRef>(function LogSection(_, ref) {
  const s = styles;

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [logSuccessCount, setLogSuccessCount] = useState(0);
  const [logFailCount, setLogFailCount] = useState(0);
  const [logWarningCount, setLogWarningCount] = useState(0);
  const [teamTab, setTeamTab] = useState<"management" | "sales">("management");
  const [logFilter, setLogFilter] = useState({
    startDate: "",
    endDate: "",
    actorName: "",
    branch: "",
    status: "",
    type: "",
  });

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({
        action: "logs",
        page: String(logPage),
        pageSize: String(LOG_PAGE_SIZE),
        team: teamTab,
      });
      if (logFilter.startDate) params.set("startDate", logFilter.startDate);
      if (logFilter.endDate) params.set("endDate", logFilter.endDate);
      if (logFilter.actorName) params.set("actorName", logFilter.actorName);
      if (logFilter.branch) params.set("branch", logFilter.branch);
      if (logFilter.status) params.set("status", logFilter.status);
      if (logFilter.type) params.set("type", logFilter.type);

      const res = await fetch(`/api/homejeonsan?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLogs(data.logs || []);
      setLogTotal(data.total || 0);
      setLogSuccessCount(data.successCount || 0);
      setLogFailCount(data.failCount || 0);
      setLogWarningCount(data.warningCount || 0);
    } catch {
      setLogs([]);
      setLogTotal(0);
      setLogSuccessCount(0);
      setLogFailCount(0);
      setLogWarningCount(0);
    } finally {
      setLogsLoading(false);
    }
  }, [logPage, logFilter, teamTab]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useImperativeHandle(ref, () => ({ fetchLogs }), [fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(logTotal / LOG_PAGE_SIZE));

  const handleFilterChange = (key: string, value: string) => {
    setLogFilter((prev) => ({ ...prev, [key]: value }));
  };

  const handleSearch = () => {
    setLogPage(1);
    // fetchLogs will be triggered by logPage/logFilter change via useEffect
  };

  const handleReset = () => {
    setLogFilter({
      startDate: "",
      endDate: "",
      actorName: "",
      branch: "",
      status: "",
      type: "",
    });
    setLogPage(1);
  };

  return (
    <div style={s.card}>
      <h2
        style={{
          fontSize: "16px",
          fontWeight: 600,
          color: "#0f172a",
          margin: "0 0 16px 0",
        }}
      >
        등록 이력
      </h2>

      {/* Team tabs */}
      <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
        {([["management", "관리팀"], ["sales", "영업자"]] as const).map(([val, label]) => (
          <button key={val} onClick={() => { setTeamTab(val); setLogPage(1); }}
            style={{
              padding: "6px 16px", fontSize: "13px", fontWeight: teamTab === val ? 600 : 400,
              color: teamTab === val ? "#fff" : "#64748b",
              backgroundColor: teamTab === val ? (val === "management" ? "#f59e0b" : "#2563eb") : "#fff",
              border: `1px solid ${teamTab === val ? (val === "management" ? "#f59e0b" : "#2563eb") : "#e2e8f0"}`,
              borderRadius: "4px", cursor: "pointer", fontFamily: "inherit",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "flex",
          gap: "16px",
          alignItems: "center",
          marginBottom: "12px",
          fontSize: "13px",
        }}
      >
        <span style={{ color: "#475569", fontWeight: 500 }}>
          전체 {logTotal}건
        </span>
        <span style={{ color: "#16a34a", fontWeight: 500 }}>
          성공 {logSuccessCount}
        </span>
        <span style={{ color: "#dc2626", fontWeight: 500 }}>
          실패 {logFailCount}
        </span>
        {logWarningCount > 0 && (
          <span style={{ color: "#b45309", fontWeight: 500 }}>
            주의 {logWarningCount}
          </span>
        )}
      </div>

      {/* Filter row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <input
          type="date"
          style={filterInputStyle}
          value={logFilter.startDate}
          onChange={(e) => handleFilterChange("startDate", e.target.value)}
          title="시작일"
        />
        <input
          type="date"
          style={filterInputStyle}
          value={logFilter.endDate}
          onChange={(e) => handleFilterChange("endDate", e.target.value)}
          title="종료일"
        />
        <input
          type="text"
          style={{ ...filterInputStyle, width: "80px" }}
          placeholder="등록자"
          value={logFilter.actorName}
          onChange={(e) => handleFilterChange("actorName", e.target.value)}
        />
        <select
          style={filterInputStyle}
          value={logFilter.branch}
          onChange={(e) => handleFilterChange("branch", e.target.value)}
        >
          {BRANCH_OPTIONS.map((b) => (
            <option key={b} value={b === "전체" ? "" : b}>
              {b}
            </option>
          ))}
        </select>
        <select
          style={filterInputStyle}
          value={logFilter.status}
          onChange={(e) => handleFilterChange("status", e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          style={filterInputStyle}
          value={logFilter.type}
          onChange={(e) => handleFilterChange("type", e.target.value)}
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          style={{
            height: "30px",
            padding: "0 12px",
            fontSize: "12px",
            fontWeight: 600,
            color: "#fff",
            backgroundColor: "#2563eb",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
          onClick={handleSearch}
        >
          검색
        </button>
        <button
          style={{
            height: "30px",
            padding: "0 12px",
            fontSize: "12px",
            fontWeight: 500,
            color: "#475569",
            backgroundColor: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: "4px",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
          onClick={handleReset}
        >
          초기화
        </button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "60px" }} />
            <col style={{ width: "60px" }} />
            <col style={{ width: "150px" }} />
            <col style={{ width: "120px" }} />
            <col style={{ width: "200px" }} />
            <col style={{ width: "110px" }} />
            <col style={{ width: "70px" }} />
            <col style={{ width: "55px" }} />
            <col style={{ width: "80px" }} />
          </colgroup>
          <thead>
            <tr>
              <th style={s.th}>상태</th>
              <th style={s.th}>유형</th>
              <th style={s.th}>일시</th>
              <th style={s.th}>업체명</th>
              <th style={s.th}>키워드</th>
              <th style={s.th}>플레이스번호</th>
              <th style={s.th}>등록자</th>
              <th style={s.th}>지사</th>
              <th style={s.th}>비고</th>
            </tr>
          </thead>
          <tbody>
            {logsLoading ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    ...s.td,
                    textAlign: "center",
                    padding: "32px 12px",
                    color: "#94a3b8",
                  }}
                >
                  로딩중...
                </td>
              </tr>
            ) : logs.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    ...s.td,
                    textAlign: "center",
                    padding: "32px 12px",
                    color: "#94a3b8",
                  }}
                >
                  이력이 없습니다
                </td>
              </tr>
            ) : (
              logs.map((log, idx) => (
                <tr
                  key={log.id}
                  style={{
                    backgroundColor: idx % 2 === 0 ? "#fff" : "#f8fafc",
                    cursor: "default",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "#f0f7ff";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor =
                      idx % 2 === 0 ? "#fff" : "#f8fafc";
                  }}
                >
                  <td style={s.td}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        borderRadius: "9999px",
                        ...(log.status !== "success"
                          ? { color: "#dc2626", backgroundColor: "#fef2f2", border: "1px solid #fecaca" }
                          : log.errorMessage?.startsWith("등록 진행 중")
                            ? { color: "#2563eb", backgroundColor: "#eff6ff", border: "1px solid #bfdbfe" }
                            : log.errorMessage
                              ? { color: "#b45309", backgroundColor: "#fffbeb", border: "1px solid #fde68a" }
                              : { color: "#15803d", backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0" }),
                      }}
                    >
                      {log.status !== "success" ? "실패" : log.errorMessage?.startsWith("등록 진행 중") ? "대기" : log.errorMessage ? "주의" : "성공"}
                    </span>
                  </td>
                  <td style={s.td}>
                    {TYPE_LABEL_MAP[log.type] || log.type}
                  </td>
                  <td style={s.td}>
                    {new Date(log.createdAt).toLocaleString("ko-KR")}
                  </td>
                  <td style={s.td}>{log.companyName}</td>
                  <td style={{ ...s.td, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.keyword || ''}>
                    {log.keyword?.split(',').map((part, pi) => {
                      const t = part.trim();
                      if (!t) return null;
                      const isUrl = t.startsWith('http://') || t.startsWith('https://') || t.startsWith('/api/');
                      if (isUrl) {
                        const display = t.replace(/^https?:\/\/(www\.)?/, '').replace(/^\/api\/.*placeId=\d+&type=/, '');
                        return <span key={pi}>{pi > 0 && ', '}<a href={t.startsWith('/') ? undefined : t} target="_blank" rel="noopener noreferrer" title={t}
                          style={{ color: '#2563eb', textDecoration: 'none', cursor: t.startsWith('/') ? 'default' : 'pointer' }}>
                          {display.length > 25 ? display.slice(0, 25) + '...' : display}
                        </a></span>;
                      }
                      return <span key={pi}>{pi > 0 && ', '}{t}</span>;
                    }) || '-'}
                  </td>
                  <td style={{ ...s.td, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.placeId}</td>
                  <td style={{ ...s.td, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.actorName || "-"}</td>
                  <td style={{ ...s.td, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.actorBranch || "-"}</td>
                  <td
                    style={{
                      ...s.td,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={log.message || log.errorMessage || ""}
                  >
                    {log.message || log.errorMessage || "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "12px",
          marginTop: "16px",
        }}
      >
        <button
          style={{
            height: "30px",
            padding: "0 12px",
            fontSize: "12px",
            color: logPage <= 1 ? "#94a3b8" : "#475569",
            backgroundColor: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "4px",
            cursor: logPage <= 1 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
          disabled={logPage <= 1}
          onClick={() => setLogPage((p) => Math.max(1, p - 1))}
        >
          이전
        </button>
        <span style={{ fontSize: "12px", color: "#475569" }}>
          {logPage} / {totalPages}
        </span>
        <button
          style={{
            height: "30px",
            padding: "0 12px",
            fontSize: "12px",
            color: logPage >= totalPages ? "#94a3b8" : "#475569",
            backgroundColor: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "4px",
            cursor: logPage >= totalPages ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
          disabled={logPage >= totalPages}
          onClick={() => setLogPage((p) => Math.min(totalPages, p + 1))}
        >
          다음
        </button>
      </div>
    </div>
  );
});

export default LogSection;
