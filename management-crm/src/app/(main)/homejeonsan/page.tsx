"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface LogEntry {
  id: number;
  status: "success" | "fail";
  createdAt: string;
  companyName: string;
  keyword: string;
  placeId: string;
  message?: string;
  errorMessage?: string;
  actorName?: string;
  actorBranch?: string;
  type: string;
}

const CATEGORIES = [
  "맛집/카페",
  "중장비/자동차",
  "뷰티/미용",
  "꽃집/스튜디오",
  "부동산/학원",
  "인테리어/청소",
  "점집/헬스,운동",
  "기타",
];

const AD_TYPES = ["정상", "선광고"];

export default function HomejeonsanPage() {
  const [activeTab, setActiveTab] = useState<"keyword" | "report">("keyword");
  
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{keywordCount: number; reportExists: boolean; keywords: string[]; reportContract?: string | null; keywordDetails?: {keyword: string; firstRank: string; rank: string; staffName: string; date: string; adType: string}[]} | null>(null);

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchResult(null);
    try {
      const res = await fetch("/api/homejeonsan?action=search_place&placeNumber=" + encodeURIComponent(searchQuery), { credentials: "include" });
      const data = await res.json();
      setSearchResult({
        keywordCount: data.keywordCount || 0,
        reportExists: data.reportExists || false,
        keywords: (data.keywords || []).map((k: {keyword: string}) => k.keyword),
        reportContract: data.reportContract || null,
        keywordDetails: data.keywords || [],
      });
    } catch {
      setSearchResult({ keywordCount: 0, reportExists: false, keywords: [], reportContract: null, keywordDetails: [] });
    } finally {
      setSearchLoading(false);
    }
  }

  const [deletingKeyword, setDeletingKeyword] = useState<string | null>(null);

  async function handleDeleteKeyword(keyword: string) {
    if (!searchQuery.trim()) return;
    if (!confirm(`"${keyword}" 키워드를 삭제하시겠습니까?`)) return;
    setDeletingKeyword(keyword);
    try {
      const res = await fetch("/api/homejeonsan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "delete_keyword", placeId: searchQuery.trim(), keyword }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Refresh the search results
        handleSearch();
      } else {
        alert(data.error || "삭제 실패");
      }
    } catch {
      alert("서버 오류가 발생했습니다.");
    } finally {
      setDeletingKeyword(null);
    }
  }

  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const [logFilter, setLogFilter] = useState({ startDate: "", endDate: "", actorName: "", branch: "", status: "" });
  const [showLogDetail, setShowLogDetail] = useState(false);
  const LOG_PAGE_SIZE = 20;
const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // -- Keyword registration form --
  const [kwForm, setKwForm] = useState({
    companyName: "",
    keyword: "",
    placeId: "",
    category: CATEGORIES[0],
    salesperson: "",
    adType: AD_TYPES[0],
  });
  const [kwSubmitting, setKwSubmitting] = useState(false);
  const [kwMessage, setKwMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // -- Report registration form --
  const [rpForm, setRpForm] = useState({
    placeId: "",
    contact1: "",
    contact2: "",
    contractStart: "",
    months: "",
  });
  const [rpSubmitting, setRpSubmitting] = useState(false);
  const [rpMessage, setRpMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // -- Excel bulk --
  const [kwFile, setKwFile] = useState<File | null>(null);
  const [kwPreview, setKwPreview] = useState<string[][]>([]);
  const [kwBulkSubmitting, setKwBulkSubmitting] = useState(false);
  const [kwBulkProgress, setKwBulkProgress] = useState(0);
  const [kwBulkMessage, setKwBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const kwFileRef = useRef<HTMLInputElement>(null);

  const [rpFile, setRpFile] = useState<File | null>(null);
  const [rpPreview, setRpPreview] = useState<string[][]>([]);
  const [rpBulkSubmitting, setRpBulkSubmitting] = useState(false);
  const [rpBulkProgress, setRpBulkProgress] = useState(0);
  const [rpBulkMessage, setRpBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const rpFileRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [kwDragOver, setKwDragOver] = useState(false);
  const [rpDragOver, setRpDragOver] = useState(false);

  const fetchLogs = useCallback(() => {
    setLogsLoading(true);
    const params = new URLSearchParams({ action: 'logs', page: String(logPage), pageSize: String(LOG_PAGE_SIZE) });
    if (logFilter.startDate) params.set('startDate', logFilter.startDate);
    if (logFilter.endDate) params.set('endDate', logFilter.endDate);
    if (logFilter.actorName) params.set('actorName', logFilter.actorName);
    if (logFilter.branch) params.set('branch', logFilter.branch);
    if (logFilter.status) params.set('status', logFilter.status);
    fetch(`/api/homejeonsan?${params}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setLogs(d.logs || []); setLogTotal(d.total || 0); })
      .catch(() => { setLogs([]); setLogTotal(0); })
      .finally(() => setLogsLoading(false));
  }, [logPage, logFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // -- Keyword single register --
  const handleKwSubmit = async () => {
    if (!kwForm.companyName || !kwForm.keyword || !kwForm.placeId) {
      setKwMessage({ type: "error", text: "상호명, 키워드, 플레이스번호를 모두 입력해주세요." });
      return;
    }
    setKwSubmitting(true);
    setKwMessage(null);
    try {
      const res = await fetch("/api/homejeonsan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "register", ...kwForm }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setKwMessage({ type: "success", text: data.message || "등록 완료" });
        setKwForm({ companyName: "", keyword: "", placeId: "", category: CATEGORIES[0], salesperson: "", adType: AD_TYPES[0] });
        fetchLogs();
      } else {
        setKwMessage({ type: "error", text: data.error || "등록 실패" });
      }
    } catch {
      setKwMessage({ type: "error", text: "서버 오류가 발생했습니다." });
    } finally {
      setKwSubmitting(false);
    }
  };

  // -- Report single register --
  const handleRpSubmit = async () => {
    if (!rpForm.placeId || !rpForm.contact1 || !rpForm.contractStart || !rpForm.months) {
      setRpMessage({ type: "error", text: "플레이스번호, 연락처1, 계약시작일, 개월수를 모두 입력해주세요." });
      return;
    }
    setRpSubmitting(true);
    setRpMessage(null);
    try {
      const res = await fetch("/api/homejeonsan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "register_report", ...rpForm }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRpMessage({ type: "success", text: data.message || "등록 완료" });
        setRpForm({ placeId: "", contact1: "", contact2: "", contractStart: "", months: "" });
        fetchLogs();
      } else {
        setRpMessage({ type: "error", text: data.error || "등록 실패" });
      }
    } catch {
      setRpMessage({ type: "error", text: "서버 오류가 발생했습니다." });
    } finally {
      setRpSubmitting(false);
    }
  };

  // -- File handling helpers --
  const handleFileSelect = (file: File, type: "keyword" | "report") => {
    const validExts = [".xlsx", ".xls", ".csv"];
    const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
    if (!validExts.includes(ext)) {
      if (type === "keyword") setKwBulkMessage({ type: "error", text: "xlsx, xls, csv 파일만 업로드 가능합니다." });
      else setRpBulkMessage({ type: "error", text: "xlsx, xls, csv 파일만 업로드 가능합니다." });
      return;
    }
    if (type === "keyword") {
      setKwFile(file);
      setKwBulkMessage(null);
      setKwPreview([]);
      loadPreview(file, "keyword");
    } else {
      setRpFile(file);
      setRpBulkMessage(null);
      setRpPreview([]);
      loadPreview(file, "report");
    }
  };

  const loadPreview = (file: File, type: "keyword" | "report") => {
    if (file.name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        if (!text) return;
        const lines = text.split("\n").filter((l) => l.trim());
        const rows = lines.map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
        if (type === "keyword") setKwPreview(rows.slice(0, 11));
        else setRpPreview(rows.slice(0, 11));
      };
      reader.readAsText(file, "UTF-8");
    } else {
      // For xlsx, send to server for preview
      const fd = new FormData();
      fd.append("file", file);
      fd.append("type", type);
      fetch("/api/homejeonsan/preview", { method: "POST", credentials: "include", body: fd })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (type === "keyword") setKwPreview(d.rows || []);
          else setRpPreview(d.rows || []);
        })
        .catch(() => {
          if (type === "keyword") setKwBulkMessage({ type: "error", text: "미리보기 로드 실패" });
          else setRpBulkMessage({ type: "error", text: "미리보기 로드 실패" });
        });
    }
  };

  // -- Bulk register --
  const handleBulkSubmit = async (type: "keyword" | "report") => {
    const file = type === "keyword" ? kwFile : rpFile;
    if (!file) return;

    const setSubmitting = type === "keyword" ? setKwBulkSubmitting : setRpBulkSubmitting;
    const setProgress = type === "keyword" ? setKwBulkProgress : setRpBulkProgress;
    const setMsg = type === "keyword" ? setKwBulkMessage : setRpBulkMessage;

    setSubmitting(true);
    setProgress(10);
    setMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("action", type === "keyword" ? "bulk_register" : "bulk_register_report");

      setProgress(30);
      const res = await fetch("/api/homejeonsan", { method: "POST", credentials: "include", body: fd });
      setProgress(70);
      const data = await res.json();
      setProgress(100);

      if (res.ok && data.success) {
        setMsg({ type: "success", text: data.message || `${data.count || 0}건 등록 완료` });
        if (type === "keyword") { setKwFile(null); setKwPreview([]); }
        else { setRpFile(null); setRpPreview([]); }
        fetchLogs();
      } else {
        setMsg({ type: "error", text: data.error || "일괄 등록 실패" });
      }
    } catch {
      setMsg({ type: "error", text: "서버 오류가 발생했습니다." });
    } finally {
      setSubmitting(false);
    }
  };

  // -- Drag & Drop handlers --
  const onDragOver = (e: React.DragEvent, type: "keyword" | "report") => {
    e.preventDefault();
    e.stopPropagation();
    if (type === "keyword") setKwDragOver(true);
    else setRpDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent, type: "keyword" | "report") => {
    e.preventDefault();
    e.stopPropagation();
    if (type === "keyword") setKwDragOver(false);
    else setRpDragOver(false);
  };
  const onDrop = (e: React.DragEvent, type: "keyword" | "report") => {
    e.preventDefault();
    e.stopPropagation();
    if (type === "keyword") setKwDragOver(false);
    else setRpDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelect(files[0], type);
  };

  // -- Styles --
  const inputStyle: React.CSSProperties = {
    height: "40px",
    padding: "0 12px",
    fontSize: "13.5px",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    outline: "none",
    width: "100%",
    backgroundColor: "#fff",
    color: "#0f172a",
    fontFamily: "inherit",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "13px",
    fontWeight: 500,
    color: "#475569",
    marginBottom: "4px",
    display: "block",
  };

  const btnPrimary: React.CSSProperties = {
    height: "36px",
    padding: "0 16px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#fff",
    backgroundColor: "#2563eb",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background-color 0.15s",
  };

  const btnDisabled: React.CSSProperties = {
    ...btnPrimary,
    opacity: 0.6,
    cursor: "not-allowed",
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    height: "36px",
    padding: "0 20px",
    fontSize: "13.5px",
    fontWeight: 600,
    color: active ? "#fff" : "#475569",
    backgroundColor: active ? "#2563eb" : "#fff",
    border: active ? "1px solid #2563eb" : "1px solid #e2e8f0",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  });

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "24px",
    marginBottom: "16px",
  };

  const msgStyle = (type: "success" | "error"): React.CSSProperties => ({
    padding: "8px 12px",
    fontSize: "13px",
    borderRadius: "6px",
    marginTop: "8px",
    backgroundColor: type === "success" ? "#f0fdf4" : "#fef2f2",
    color: type === "success" ? "#15803d" : "#dc2626",
    border: type === "success" ? "1px solid #bbf7d0" : "1px solid #fecaca",
  });

  const dropZoneStyle = (dragOver: boolean): React.CSSProperties => ({
    border: dragOver ? "2px dashed #2563eb" : "2px dashed #e2e8f0",
    borderRadius: "8px",
    padding: "32px",
    textAlign: "center" as const,
    cursor: "pointer",
    backgroundColor: dragOver ? "#eff6ff" : "#fafafa",
    transition: "all 0.15s",
  });

  const thStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#475569",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left" as const,
    whiteSpace: "nowrap" as const,
  };

  const tdStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: "13px",
    color: "#0f172a",
    borderBottom: "1px solid #f1f5f9",
    whiteSpace: "nowrap" as const,
  };

  return (
    <div style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: 0 }}>홈전산 관리</h1>
        <p style={{ fontSize: "13.5px", color: "#64748b", marginTop: "4px" }}>키워드 등록 및 리포트 등록을 관리합니다.</p>
      </div>
        {/* 업체 검색 + 등록 여부 확인 */}
        <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", padding: "20px", marginBottom: "20px" }}>
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", marginBottom: "12px" }}>업체 등록 현황 조회</h2>
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <input
              type="text"
              placeholder="플레이스번호 또는 업체명 입력"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
              style={{ flex: 1, height: "36px", padding: "0 12px", fontSize: "13px", border: "1px solid #e2e8f0", outline: "none" }}
            />
            <button
              onClick={handleSearch}
              disabled={searchLoading}
              style={{ height: "36px", padding: "0 16px", fontSize: "13px", fontWeight: 500, color: "#fff", backgroundColor: "#2563eb", border: "none", cursor: "pointer" }}
            >
              {searchLoading ? "조회중..." : "조회"}
            </button>
          </div>
          {searchResult && (
            <div style={{ border: "1px solid #e2e8f0", padding: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>키워드 등록</span>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: searchResult.keywordCount > 0 ? "#16a34a" : "#dc2626", marginTop: "4px" }}>
                    {searchResult.keywordCount > 0 ? searchResult.keywordCount + "건 등록됨" : "미등록"}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>리포트 생성</span>
                  <div style={{ fontSize: "16px", fontWeight: 700, color: searchResult.reportExists ? "#16a34a" : "#dc2626", marginTop: "4px" }}>
                    {searchResult.reportExists ? (searchResult.reportContract ? "생성됨 (" + searchResult.reportContract + ")" : "생성됨") : "미생성"}
                  </div>
                </div>
              </div>
              {searchResult.keywordDetails && searchResult.keywordDetails.length > 0 && (
                <div style={{ marginTop: "12px" }}>
                  <span style={{ fontSize: "12px", color: "#64748b", display: "inline-block", marginBottom: "8px" }}>등록된 키워드 ({searchResult.keywordCount}건):
                    <button onClick={() => navigator.clipboard.writeText(searchQuery)}
                      style={{ marginLeft: 8, padding: '2px 8px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: 11, cursor: 'pointer', color: '#64748b' }}>
                      번호 복사
                    </button>
                  </span>
                  <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#64748b" }}>키워드</th>
                        <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b" }}>최초 순위</th>
                        <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b" }}>현재 순위</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#64748b" }}>담당자</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#64748b" }}>등록일</th>
                        <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b" }}>유형</th>
                        <th style={{ padding: "6px 8px", textAlign: "center", color: "#64748b", width: "60px" }}>삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResult.keywordDetails.map((kw, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 500, color: "#0f172a" }}>{kw.keyword}</td>
                          <td style={{ padding: "6px 8px", textAlign: "center", color: "#94a3b8", fontWeight: 500 }}>{kw.firstRank || "-"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "center", color: kw.rank === "순위없음" ? "#94a3b8" : "#2563eb", fontWeight: 600 }}>{kw.rank || "-"}</td>
                          <td style={{ padding: "6px 8px", color: "#475569" }}>{kw.staffName || "-"}</td>
                          <td style={{ padding: "6px 8px", color: "#94a3b8" }}>{kw.date || "-"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            <span style={{ padding: "1px 6px", fontSize: "11px", backgroundColor: kw.adType === "선광고" ? "#fffbeb" : "#f0fdf4", color: kw.adType === "선광고" ? "#d97706" : "#16a34a" }}>{kw.adType || "정상"}</span>
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center" }}>
                            <button
                              onClick={() => handleDeleteKeyword(kw.keyword)}
                              disabled={deletingKeyword === kw.keyword}
                              style={{
                                padding: "2px 8px",
                                fontSize: "11px",
                                fontWeight: 500,
                                color: deletingKeyword === kw.keyword ? "#94a3b8" : "#dc2626",
                                backgroundColor: deletingKeyword === kw.keyword ? "#f1f5f9" : "#fef2f2",
                                border: "1px solid",
                                borderColor: deletingKeyword === kw.keyword ? "#e2e8f0" : "#fecaca",
                                borderRadius: "4px",
                                cursor: deletingKeyword === kw.keyword ? "not-allowed" : "pointer",
                                fontFamily: "inherit",
                                transition: "background-color 0.15s",
                              }}
                            >
                              {deletingKeyword === kw.keyword ? "..." : "삭제"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>


      {/* Tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
        <button style={tabStyle(activeTab === "keyword")} onClick={() => setActiveTab("keyword")}>키워드 등록</button>
        <button style={tabStyle(activeTab === "report")} onClick={() => setActiveTab("report")}>리포트 등록</button>
      </div>

      {/* Tab 1: Keyword Registration */}
      {activeTab === "keyword" && (
        <>
          {/* Single Registration */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", margin: "0 0 16px 0" }}>단건 등록</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <div>
                <label style={labelStyle}>상호명</label>
                <input style={inputStyle} type="text" placeholder="상호명 입력" value={kwForm.companyName} onChange={(e) => setKwForm({ ...kwForm, companyName: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>키워드 (콤마 구분)</label>
                <input style={inputStyle} type="text" placeholder="키워드1, 키워드2" value={kwForm.keyword} onChange={(e) => setKwForm({ ...kwForm, keyword: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>플레이스번호</label>
                <input style={inputStyle} type="text" placeholder="플레이스 고유번호" value={kwForm.placeId} onChange={(e) => setKwForm({ ...kwForm, placeId: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>카테고리</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={kwForm.category} onChange={(e) => setKwForm({ ...kwForm, category: e.target.value })}>
                  {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div>
                <label style={labelStyle}>영업자</label>
                <input style={inputStyle} type="text" placeholder="영업자명" value={kwForm.salesperson} onChange={(e) => setKwForm({ ...kwForm, salesperson: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>정상/선광고</label>
                <select style={{ ...inputStyle, cursor: "pointer" }} value={kwForm.adType} onChange={(e) => setKwForm({ ...kwForm, adType: e.target.value })}>
                  {AD_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </div>
            </div>
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
              <button style={kwSubmitting ? btnDisabled : btnPrimary} disabled={kwSubmitting} onClick={handleKwSubmit}>
                {kwSubmitting ? "등록중..." : "등록"}
              </button>
              {kwMessage && <span style={msgStyle(kwMessage.type)}>{kwMessage.text}</span>}
            </div>
          </div>

          {/* Bulk Registration */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", margin: "0 0 16px 0" }}>엑셀 일괄 등록</h2>
            <p style={{ fontSize: "12.5px", color: "#64748b", marginBottom: "12px" }}>양식: 상호명, 키워드, 고유번호, 카테고리, 영업자, 정상/선광고</p>
            <div
              style={dropZoneStyle(kwDragOver)}
              onDragOver={(e) => onDragOver(e, "keyword")}
              onDragLeave={(e) => onDragLeave(e, "keyword")}
              onDrop={(e) => onDrop(e, "keyword")}
              onClick={() => kwFileRef.current?.click()}
            >
              <input ref={kwFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0], "keyword"); }} />
              {kwFile ? (
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 500, color: "#0f172a" }}>{kwFile.name}</p>
                  <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{(kwFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: "0 auto 8px" }}>
                    <path d="M20 6v20M12 18l8-8 8 8" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6 28v4a2 2 0 002 2h24a2 2 0 002-2v-4" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <p style={{ fontSize: "14px", color: "#475569" }}>파일을 드래그하거나 클릭하여 업로드</p>
                  <p style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>xlsx, xls, csv</p>
                </div>
              )}
            </div>

            {/* Preview */}
            {kwPreview.length > 0 && (
              <div style={{ marginTop: "16px", overflowX: "auto" }}>
                <p style={{ fontSize: "13px", fontWeight: 500, color: "#475569", marginBottom: "8px" }}>미리보기 (최대 10행)</p>
                <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                  <thead>
                    <tr>
                      {kwPreview[0]?.map((h, i) => (<th key={i} style={thStyle}>{h}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {kwPreview.slice(1).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (<td key={ci} style={tdStyle}>{cell}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bulk action */}
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
              <button
                style={!kwFile || kwBulkSubmitting ? btnDisabled : btnPrimary}
                disabled={!kwFile || kwBulkSubmitting}
                onClick={() => handleBulkSubmit("keyword")}
              >
                {kwBulkSubmitting ? "등록중..." : "일괄 등록"}
              </button>
              {kwBulkSubmitting && (
                <div style={{ flex: 1, maxWidth: "200px" }}>
                  <div style={{ height: "6px", backgroundColor: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: kwBulkProgress + "%", backgroundColor: "#2563eb", borderRadius: "3px", transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{kwBulkProgress}%</span>
                </div>
              )}
              {kwBulkMessage && <span style={msgStyle(kwBulkMessage.type)}>{kwBulkMessage.text}</span>}
            </div>
          </div>
        </>
      )}

      {/* Tab 2: Report Registration */}
      {activeTab === "report" && (
        <>
          {/* Single Registration */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", margin: "0 0 16px 0" }}>단건 등록</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
              <div>
                <label style={labelStyle}>플레이스번호</label>
                <input style={inputStyle} type="text" placeholder="플레이스 고유번호" value={rpForm.placeId} onChange={(e) => setRpForm({ ...rpForm, placeId: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>연락처1</label>
                <input style={inputStyle} type="text" placeholder="010-0000-0000" value={rpForm.contact1} onChange={(e) => setRpForm({ ...rpForm, contact1: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>연락처2 (선택)</label>
                <input style={inputStyle} type="text" placeholder="연락처2" value={rpForm.contact2} onChange={(e) => setRpForm({ ...rpForm, contact2: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>계약시작일</label>
                <input style={inputStyle} type="date" value={rpForm.contractStart} onChange={(e) => setRpForm({ ...rpForm, contractStart: e.target.value })} />
              </div>
              <div>
                <label style={labelStyle}>개월수</label>
                <input style={inputStyle} type="number" min="1" placeholder="개월수" value={rpForm.months} onChange={(e) => setRpForm({ ...rpForm, months: e.target.value })} />
              </div>
            </div>
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
              <button style={rpSubmitting ? btnDisabled : btnPrimary} disabled={rpSubmitting} onClick={handleRpSubmit}>
                {rpSubmitting ? "등록중..." : "등록"}
              </button>
              {rpMessage && <span style={msgStyle(rpMessage.type)}>{rpMessage.text}</span>}
            </div>
          </div>

          {/* Bulk Registration */}
          <div style={cardStyle}>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", margin: "0 0 16px 0" }}>엑셀 일괄 등록</h2>
            <p style={{ fontSize: "12.5px", color: "#64748b", marginBottom: "12px" }}>양식: 플레이스번호, 연락처1, 연락처2, 계약시작일, 개월수</p>
            <div
              style={dropZoneStyle(rpDragOver)}
              onDragOver={(e) => onDragOver(e, "report")}
              onDragLeave={(e) => onDragLeave(e, "report")}
              onDrop={(e) => onDrop(e, "report")}
              onClick={() => rpFileRef.current?.click()}
            >
              <input ref={rpFileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0], "report"); }} />
              {rpFile ? (
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 500, color: "#0f172a" }}>{rpFile.name}</p>
                  <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{(rpFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ margin: "0 auto 8px" }}>
                    <path d="M20 6v20M12 18l8-8 8 8" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M6 28v4a2 2 0 002 2h24a2 2 0 002-2v-4" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <p style={{ fontSize: "14px", color: "#475569" }}>파일을 드래그하거나 클릭하여 업로드</p>
                  <p style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>xlsx, xls, csv</p>
                </div>
              )}
            </div>

            {/* Preview */}
            {rpPreview.length > 0 && (
              <div style={{ marginTop: "16px", overflowX: "auto" }}>
                <p style={{ fontSize: "13px", fontWeight: 500, color: "#475569", marginBottom: "8px" }}>미리보기 (최대 10행)</p>
                <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0", borderRadius: "6px" }}>
                  <thead>
                    <tr>
                      {rpPreview[0]?.map((h, i) => (<th key={i} style={thStyle}>{h}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {rpPreview.slice(1).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (<td key={ci} style={tdStyle}>{cell}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bulk action */}
            <div style={{ marginTop: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
              <button
                style={!rpFile || rpBulkSubmitting ? btnDisabled : btnPrimary}
                disabled={!rpFile || rpBulkSubmitting}
                onClick={() => handleBulkSubmit("report")}
              >
                {rpBulkSubmitting ? "등록중..." : "일괄 등록"}
              </button>
              {rpBulkSubmitting && (
                <div style={{ flex: 1, maxWidth: "200px" }}>
                  <div style={{ height: "6px", backgroundColor: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: rpBulkProgress + "%", backgroundColor: "#2563eb", borderRadius: "3px", transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>{rpBulkProgress}%</span>
                </div>
              )}
              {rpBulkMessage && <span style={msgStyle(rpBulkMessage.type)}>{rpBulkMessage.text}</span>}
            </div>
          </div>
        </>
      )}

      {/* Registration Logs */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#0f172a", margin: "0 0 16px 0" }}>등록 이력</h2>
        {logsLoading ? (
          <p style={{ fontSize: "13px", color: "#64748b" }}>로딩중...</p>
        ) : logs.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#94a3b8" }}>등록 이력이 없습니다.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            
          {!logsLoading && logs.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, fontSize: 13 }}>
              <span>전체 <b>{logTotal}</b>건</span>
              <span style={{ color: '#16a34a' }}>성공 <b>{logs.filter(l => l.status === 'success').length}</b></span>
              <span style={{ color: '#dc2626' }}>실패 <b>{logs.filter(l => l.status === 'fail').length}</b></span>
            </div>
          )}
          <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "2px" }}>시작일</label>
              <input type="date" value={logFilter.startDate} onChange={(e) => setLogFilter({...logFilter, startDate: e.target.value})} style={{ height: "30px", padding: "0 6px", fontSize: "12px", border: "1px solid #e2e8f0" }} />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "2px" }}>종료일</label>
              <input type="date" value={logFilter.endDate} onChange={(e) => setLogFilter({...logFilter, endDate: e.target.value})} style={{ height: "30px", padding: "0 6px", fontSize: "12px", border: "1px solid #e2e8f0" }} />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "2px" }}>등록자</label>
              <input type="text" placeholder="이름" value={logFilter.actorName} onChange={(e) => setLogFilter({...logFilter, actorName: e.target.value})} style={{ height: "30px", padding: "0 6px", width: "80px", fontSize: "12px", border: "1px solid #e2e8f0" }} />
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "2px" }}>지사</label>
              <select value={logFilter.branch} onChange={(e) => setLogFilter({...logFilter, branch: e.target.value})} style={{ height: "30px", padding: "0 6px", fontSize: "12px", border: "1px solid #e2e8f0" }}>
                <option value="">전체</option>
                <option value="인천">인천</option>
                <option value="수원">수원</option>
                <option value="동탄">동탄</option>
                <option value="용인">용인</option>
                <option value="부산">부산</option>
                <option value="본사">본사</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: "11px", color: "#64748b", display: "block", marginBottom: "2px" }}>상태</label>
              <select value={logFilter.status} onChange={(e) => setLogFilter({...logFilter, status: e.target.value})} style={{ height: "30px", padding: "0 6px", fontSize: "12px", border: "1px solid #e2e8f0" }}>
                <option value="">전체</option>
                <option value="success">성공</option>
                <option value="failed">실패</option>
              </select>
            </div>
            <button onClick={() => { setLogPage(1); }} style={{ height: "30px", padding: "0 12px", fontSize: "12px", fontWeight: 500, color: "#fff", backgroundColor: "#2563eb", border: "none", cursor: "pointer" }}>검색</button>
            <button onClick={() => { setLogFilter({ startDate: "", endDate: "", actorName: "", branch: "", status: "" }); setLogPage(1); }} style={{ height: "30px", padding: "0 12px", fontSize: "12px", color: "#64748b", backgroundColor: "#fff", border: "1px solid #e2e8f0", cursor: "pointer" }}>초기화</button>
          </div>
<table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #e2e8f0" }}>
              <thead>
                <tr>
                  <th style={thStyle}>상태</th>
                  <th style={thStyle}>유형</th>
                  <th style={thStyle}>일시</th>
                  <th style={thStyle}>업체명</th>
                  <th style={thStyle}>키워드</th>
                  <th style={thStyle}>플레이스번호</th>
                  <th style={thStyle}>등록자</th>
                  <th style={thStyle}>지사</th>
                  <th style={thStyle}>비고</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, i) => (
                  <tr key={log.id}
                    style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f0f7ff'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#f8fafc'; }}>
                    <td style={tdStyle}>
                      <span style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 600,
                        borderRadius: "4px",
                        backgroundColor: log.status === "success" ? "#f0fdf4" : "#fef2f2",
                        color: log.status === "success" ? "#15803d" : "#dc2626",
                      }}>
                        {log.status === "success" ? "성공" : "실패"}
                      </span>
                    </td>
                    <td style={tdStyle}>{log.type === "keyword" ? "키워드" : "리포트"}</td>
                    <td style={tdStyle}>{log.createdAt ? new Date(log.createdAt).toLocaleString("ko-KR") : "-"}</td>
                    <td style={tdStyle}>{log.companyName || "-"}</td>
                    <td style={{ ...tdStyle, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" }}>{log.keyword || "-"}</td>
                    <td style={tdStyle}>{log.placeId || "-"}</td>
                    <td style={tdStyle}>{log.actorName || "-"}</td>
                    <td style={tdStyle}>{log.actorBranch || "-"}</td>
                    <td style={{ ...tdStyle, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" }}>{log.errorMessage || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {logTotal > LOG_PAGE_SIZE && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                <button disabled={logPage <= 1} onClick={() => setLogPage(p => p - 1)}
                  style={{ padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, cursor: logPage <= 1 ? 'not-allowed' : 'pointer', opacity: logPage <= 1 ? 0.5 : 1 }}>이전</button>
                <span style={{ fontSize: 13, color: '#475569', lineHeight: '32px' }}>{logPage} / {Math.ceil(logTotal / LOG_PAGE_SIZE)}</span>
                <button disabled={logPage >= Math.ceil(logTotal / LOG_PAGE_SIZE)} onClick={() => setLogPage(p => p + 1)}
                  style={{ padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, cursor: logPage >= Math.ceil(logTotal / LOG_PAGE_SIZE) ? 'not-allowed' : 'pointer', opacity: logPage >= Math.ceil(logTotal / LOG_PAGE_SIZE) ? 0.5 : 1 }}>다음</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
