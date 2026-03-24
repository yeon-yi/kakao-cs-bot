"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

// ── Types ──────────────────────────────────────────────────────────
type SolutionTab = "all" | "blog" | "insta" | "homepage" | "video";

interface ParsedRow {
  checked: boolean;
  companyName: string;
  representative: string;
  blogCount?: number;
  instaCount?: number;
  homepageDone?: boolean;
  videoDone?: boolean;
}

interface ResultRow {
  companyName: string;
  status: "success" | "fail";
  reason?: string;
}

interface PreviewRow {
  companyName: string;
  representative: string;
  blogCount: number;
  instaCount: number;
  homepageDone: boolean;
  videoDone: boolean;
}

interface BulkLogDetailItem {
  companyName: string;
  companyId: number | null;
  blogCount?: number | null;
  instaCount?: number | null;
  homepageDone?: boolean | null;
  videoDone?: boolean | null;
  status: "success" | "fail";
  reason?: string;
}

interface BulkLogEntry {
  id: number;
  userId: number;
  user: { displayName: string };
  type: string;
  totalCount: number;
  successCount: number;
  failCount: number;
  details: string;
  createdAt: string;
  rolledBack: boolean;
}

// ── Tab config ─────────────────────────────────────────────────────
const TAB_CONFIG: Record<SolutionTab, { label: string; headers: string[]; sampleRows: string[][] }> = {
  all: {
    label: "전체",
    headers: ["업체명", "대표자", "블로그건수", "인스타건수", "홈페이지완료(O/X)", "영상완료(O/X)"],
    sampleRows: [
      ["테스트업체", "홍길동", "5", "3", "O", "X"],
      ["샘플회사", "", "10", "0", "O", "O"],
    ],
  },
  blog: {
    label: "블로그",
    headers: ["업체명", "대표자", "블로그건수"],
    sampleRows: [
      ["테스트업체", "홍길동", "5"],
      ["샘플회사", "", "10"],
    ],
  },
  insta: {
    label: "인스타",
    headers: ["업체명", "대표자", "인스타건수"],
    sampleRows: [
      ["테스트업체", "홍길동", "3"],
      ["샘플회사", "", "8"],
    ],
  },
  homepage: {
    label: "홈페이지",
    headers: ["업체명", "대표자", "홈페이지완료(O/X)"],
    sampleRows: [
      ["테스트업체", "홍길동", "O"],
      ["샘플회사", "", "X"],
    ],
  },
  video: {
    label: "영상",
    headers: ["업체명", "대표자", "영상완료(O/X)"],
    sampleRows: [
      ["테스트업체", "홍길동", "O"],
      ["샘플회사", "", "X"],
    ],
  },
};

const TABS: SolutionTab[] = ["all", "blog", "insta", "homepage", "video"];

const TYPE_LABEL: Record<string, string> = {
  all: "전체",
  blog: "블로그",
  insta: "인스타",
  homepage: "홈페이지",
  video: "영상",
};

// ── Helpers ────────────────────────────────────────────────────────
function parseOX(value: string | undefined | null): boolean | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const v = String(value).trim().toUpperCase();
  if (v === "O" || v === "Y" || v === "TRUE" || v === "1" || v === "완료") return true;
  if (v === "X" || v === "N" || v === "FALSE" || v === "0" || v === "미완료") return false;
  return undefined;
}

function parseNumber(value: string | undefined | null): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const n = Number(value);
  return isNaN(n) ? undefined : n;
}

function boolToOX(val: boolean | undefined | null): string {
  if (val === true) return "O";
  if (val === false) return "X";
  return "";
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeParseDetails(json: string): BulkLogDetailItem[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summarizeCompanies(details: BulkLogDetailItem[]): string {
  const names = details.map((d) => d.companyName).filter(Boolean);
  if (names.length === 0) return "-";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(", ");
  return `${names[0]}, ${names[1]} 외 ${names.length - 2}건`;
}

// ── Component ──────────────────────────────────────────────────────
export default function SolutionBulkPage() {
  const [tab, setTab] = useState<SolutionTab>("all");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // History state
  const [historyLogs, setHistoryLogs] = useState<BulkLogEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [expandedDetails, setExpandedDetails] = useState<BulkLogDetailItem[]>([]);
  const [rollingBackLogId, setRollingBackLogId] = useState<number | null>(null);

  // Selective rollback state
  const [selectedRollbackItems, setSelectedRollbackItems] = useState<Set<string>>(new Set());
  const [selectiveRollingBack, setSelectiveRollingBack] = useState(false);

  // Inline batch edit state
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, { blogCount: string; instaCount: string; homepageDone: boolean | null; videoDone: boolean | null }>>({});
  const [editSaving, setEditSaving] = useState(false);

  // Pending companies state
  const [pendingBranches, setPendingBranches] = useState<string[]>([]);
  const [pendingCompanies, setPendingCompanies] = useState<Array<{ companyName: string; representative: string; branch: string; placeId: string | null; current: string }>>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [userMgmtTeam, setUserMgmtTeam] = useState<string | null>(null);
  const [pendingYearMonth, setPendingYearMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [pendingAvailableMonths, setPendingAvailableMonths] = useState<string[]>([]);

  // ── Styles ─────────────────────────────────────────────────────
  const fontStack = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif';

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "24px",
    marginBottom: "16px",
  };

  const thStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#475569",
    backgroundColor: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    textAlign: "left",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 14px",
    fontSize: "13px",
    color: "#0f172a",
    borderBottom: "1px solid #f1f5f9",
    whiteSpace: "nowrap",
  };

  const btnPurple: React.CSSProperties = {
    height: "36px",
    padding: "0 18px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#fff",
    backgroundColor: "#8b5cf6",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background-color 0.15s",
  };

  const btnSecondary: React.CSSProperties = {
    height: "36px",
    padding: "0 16px",
    fontSize: "13px",
    fontWeight: 600,
    color: "#475569",
    backgroundColor: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background-color 0.15s",
  };

  const btnSmall: React.CSSProperties = {
    height: "28px",
    padding: "0 10px",
    fontSize: "12px",
    fontWeight: 500,
    border: "1px solid #e2e8f0",
    borderRadius: "4px",
    cursor: "pointer",
    fontFamily: "inherit",
    backgroundColor: "#fff",
    color: "#475569",
  };

  // ── Checked count ──────────────────────────────────────────────
  const checkedCount = rows.filter((r) => r.checked).length;

  // ── Fetch history ──────────────────────────────────────────────
  const fetchHistory = useCallback(async (page: number) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/solutions/bulk?action=history&page=${page}&pageSize=20`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryLogs(data.logs || []);
        setHistoryTotal(data.total || 0);
        setHistoryPage(data.page || 1);
        setHistoryTotalPages(data.totalPages || 1);
      }
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory(1);
  }, [fetchHistory]);

  // ── Fetch user mgmtTeam + team branch mapping (monthly) ──────
  const fetchTeamBranches = useCallback(async (ym: string) => {
    try {
      const authRes = await fetch('/api/auth', { credentials: 'include' });
      const authData = await authRes.json();
      const team = authData.user?.mgmtTeam || null;
      const position = authData.user?.mgmtPosition || null;
      const role = authData.user?.role || '';
      setUserMgmtTeam(team);

      const isLeader = position === 'director' || position === 'deputy' || position === 'sp' || role === 'admin';
      const teamRes = await fetch(`/api/settings/mgmt-teams?yearMonth=${ym}`, { credentials: 'include' });
      const teamData = await teamRes.json();
      setPendingAvailableMonths(teamData.availableMonths || []);

      if (isLeader) {
        const all = [...new Set([...(teamData.team1Branches || []), ...(teamData.team2Branches || [])])];
        setPendingBranches(all);
      } else if (team) {
        const branches = team === '1' ? (teamData.team1Branches || []) : team === '2' ? (teamData.team2Branches || []) : [];
        setPendingBranches(branches);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchTeamBranches(pendingYearMonth);
  }, [fetchTeamBranches, pendingYearMonth]);

  // ── Fetch pending companies ────────────────────────────────────
  async function fetchPending() {
    if (pendingBranches.length === 0) return;
    setPendingLoading(true);
    setPendingCompanies([]);
    try {
      const res = await fetch(`/api/solutions/pending?solution=${tab}&branches=${encodeURIComponent(pendingBranches.join(','))}&yearMonth=${pendingYearMonth}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setPendingCompanies(data.companies || []);
      }
    } catch {
      // silent
    } finally {
      setPendingLoading(false);
    }
  }

  // ── Generate pending template Excel ────────────────────────────
  function generatePendingTemplate() {
    const config = TAB_CONFIG[tab];
    const rows = pendingCompanies.map(c => {
      const row: string[] = [c.companyName, c.representative];
      for (let i = 2; i < config.headers.length; i++) row.push('');
      return row;
    });
    const wsData = [config.headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = config.headers.map((h: string) => ({ wch: Math.max(h.length * 2.5, 16) }));
    const headerRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: col });
      if (ws[addr]) {
        ws[addr].s = {
          fill: { fgColor: { rgb: '4472C4' } },
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: '2F5496' } },
            bottom: { style: 'thin', color: { rgb: '2F5496' } },
            left: { style: 'thin', color: { rgb: '2F5496' } },
            right: { style: 'thin', color: { rgb: '2F5496' } },
          },
        };
      }
    }
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const addr = XLSX.utils.encode_cell({ r: row, c: col });
        if (ws[addr]) {
          ws[addr].s = {
            alignment: { horizontal: 'center', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: 'D6DCE4' } },
              bottom: { style: 'thin', color: { rgb: 'D6DCE4' } },
              left: { style: 'thin', color: { rgb: 'D6DCE4' } },
              right: { style: 'thin', color: { rgb: 'D6DCE4' } },
            },
          };
        }
      }
    }
    ws['!rows'] = [{ hpx: 28 }, ...rows.map(() => ({ hpx: 22 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '미완료업체');
    XLSX.writeFile(wb, `미완료_${TAB_CONFIG[tab].label}_양식.xlsx`);
  }

  // ── CSV parser for tab-aware columns ───────────────────────────
  function parseCsvRows(text: string, currentTab: SolutionTab): ParsedRow[] {
    // Remove BOM
    const clean = text.replace(/^\uFEFF/, "");
    const lines = clean.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    // Skip header row
    const dataLines = lines.slice(1);
    const parsed: ParsedRow[] = [];

    for (const line of dataLines) {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const companyName = (cols[0] || "").trim();
      if (!companyName) continue;

      const representative = (cols[1] || "").trim();

      const row: ParsedRow = {
        checked: true,
        companyName,
        representative,
      };

      if (currentTab === "all") {
        row.blogCount = parseNumber(cols[2]);
        row.instaCount = parseNumber(cols[3]);
        row.homepageDone = parseOX(cols[4]);
        row.videoDone = parseOX(cols[5]);
      } else if (currentTab === "blog") {
        row.blogCount = parseNumber(cols[2]);
      } else if (currentTab === "insta") {
        row.instaCount = parseNumber(cols[2]);
      } else if (currentTab === "homepage") {
        row.homepageDone = parseOX(cols[2]);
      } else if (currentTab === "video") {
        row.videoDone = parseOX(cols[2]);
      }

      parsed.push(row);
    }

    return parsed;
  }

  // ── File handler ───────────────────────────────────────────────
  const handleFileSelect = useCallback(
    (f: File) => {
      const ext = f.name.substring(f.name.lastIndexOf(".")).toLowerCase();
      if (![".csv", ".xlsx", ".xls"].includes(ext)) {
        setMessage({ type: "error", text: "CSV 또는 엑셀(.xlsx, .xls) 파일을 업로드해주세요." });
        return;
      }

      setFile(f);
      setMessage(null);
      setResults(null);

      if (ext === ".csv") {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result as string;
          if (!text) return;
          const parsed = parseCsvRows(text, tab);
          setRows(parsed);
        };
        reader.readAsText(f, "UTF-8");
      } else {
        // xlsx/xls
        const reader = new FileReader();
        reader.onload = (e) => {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const csv = XLSX.utils.sheet_to_csv(ws);
          const parsed = parseCsvRows(csv, tab);
          setRows(parsed);
        };
        reader.readAsArrayBuffer(f);
      }
    },
    [tab],
  );

  // ── Drag & Drop ────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelect(files[0]);
  };

  // ── Template download ──────────────────────────────────────────
  function downloadTemplate() {
    const config = TAB_CONFIG[tab];
    const wsData = [config.headers, ...config.sampleRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    // 열 너비
    ws['!cols'] = config.headers.map((h: string) => ({ wch: Math.max(h.length * 2.5, 16) }));
    // 헤더 스타일 (배경색 + 굵게 + 테두리)
    const headerRange = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: col });
      if (ws[addr]) {
        ws[addr].s = {
          fill: { fgColor: { rgb: '4472C4' } },
          font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: '2F5496' } },
            bottom: { style: 'thin', color: { rgb: '2F5496' } },
            left: { style: 'thin', color: { rgb: '2F5496' } },
            right: { style: 'thin', color: { rgb: '2F5496' } },
          },
        };
      }
    }
    // 데이터 행 테두리
    for (let row = 1; row <= headerRange.e.r; row++) {
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const addr = XLSX.utils.encode_cell({ r: row, c: col });
        if (ws[addr]) {
          ws[addr].s = {
            alignment: { horizontal: 'center', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: 'D6DCE4' } },
              bottom: { style: 'thin', color: { rgb: 'D6DCE4' } },
              left: { style: 'thin', color: { rgb: 'D6DCE4' } },
              right: { style: 'thin', color: { rgb: 'D6DCE4' } },
            },
          };
        }
      }
    }
    // 행 높이
    ws['!rows'] = [{ hpx: 28 }, ...config.sampleRows.map(() => ({ hpx: 22 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '양식');
    const tabLabel = config.label === "전체" ? "" : `_${config.label}`;
    XLSX.writeFile(wb, `솔루션_일괄등록_양식${tabLabel}.xlsx`);
  }

  // ── Results CSV download ───────────────────────────────────────
  function downloadResults() {
    if (!results) return;
    const bom = "\uFEFF";
    const header = "업체명,상태,사유";
    const csvRows = results.map((r) =>
      [r.companyName, r.status === "success" ? "성공" : "실패", r.reason || ""].join(","),
    );
    const csv = bom + [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "솔루션_일괄등록_결과.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Select / Deselect all ──────────────────────────────────────
  function selectAll() {
    setRows((prev) => prev.map((r) => ({ ...r, checked: true })));
  }
  function deselectAll() {
    setRows((prev) => prev.map((r) => ({ ...r, checked: false })));
  }
  function toggleRow(index: number) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, checked: !r.checked } : r)));
  }

  // ── Submit ─────────────────────────────────────────────────────
  async function handleSubmit() {
    const checkedRows = rows.filter((r) => r.checked);
    if (checkedRows.length === 0) {
      setMessage({ type: "error", text: "선택된 행이 없습니다." });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setResults(null);

    try {
      const items = checkedRows.map((r) => ({
        companyName: r.companyName,
        representative: r.representative || undefined,
        blogCount: r.blogCount,
        instaCount: r.instaCount,
        homepageDone: r.homepageDone,
        videoDone: r.videoDone,
      }));

      const res = await fetch("/api/solutions/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ items, type: tab }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.message || "처리 중 오류가 발생했습니다." });
        return;
      }

      setResults(data.results || []);
      setSuccessCount(data.successCount || 0);
      setFailCount(data.failCount || 0);

      setMessage({
        type: data.failCount === 0 ? "success" : "error",
        text: `처리 완료 -- 성공 ${data.successCount}건 / 실패 ${data.failCount}건`,
      });

      // Refresh history
      fetchHistory(1);
    } catch {
      setMessage({ type: "error", text: "서버 오류가 발생했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Full Rollback via history ──────────────────────────────────
  async function handleRollbackLog(logId: number) {
    const confirmed = window.confirm("이 일괄 등록을 롤백하시겠습니까? 추가된 건수가 차감됩니다.");
    if (!confirmed) return;

    setRollingBackLogId(logId);
    try {
      const res = await fetch("/api/solutions/bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ logId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.message || "롤백 중 오류가 발생했습니다." });
        return;
      }

      setMessage({
        type: data.failCount === 0 ? "success" : "error",
        text: `롤백 완료 -- 성공 ${data.successCount}건 / 실패 ${data.failCount}건`,
      });

      // Refresh history
      fetchHistory(historyPage);
      if (expandedLogId === logId) {
        setExpandedLogId(null);
        setExpandedDetails([]);
      }
    } catch {
      setMessage({ type: "error", text: "롤백 중 서버 오류가 발생했습니다." });
    } finally {
      setRollingBackLogId(null);
    }
  }

  // ── Selective rollback (selected items only) ───────────────────
  async function handleSelectiveRollback(logId: number) {
    if (selectedRollbackItems.size === 0) return;
    const confirmed = window.confirm(`선택한 ${selectedRollbackItems.size}건을 롤백하시겠습니까?`);
    if (!confirmed) return;

    setSelectiveRollingBack(true);
    let totalSuccess = 0;
    let totalFail = 0;

    for (const companyName of selectedRollbackItems) {
      const item = expandedDetails.find((d) => d.companyName === companyName && d.status === "success");
      if (!item || !item.companyId) { totalFail++; continue; }

      try {
        // Use PATCH to set values to 0 (effectively rolling back)
        // We do separate calls for blogCount and instaCount
        for (const field of ["blogCount", "instaCount"] as const) {
          const val = item[field];
          if (val != null && Number(val) > 0) {
            const res = await fetch("/api/solutions/bulk", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                logId,
                companyName: item.companyName,
                field,
                oldValue: Number(val),
                newValue: 0,
              }),
            });
            if (!res.ok) {
              totalFail++;
              continue;
            }
          }
        }
        totalSuccess++;
      } catch {
        totalFail++;
      }
    }

    setMessage({
      type: totalFail === 0 ? "success" : "error",
      text: `선택 롤백 완료 -- 성공 ${totalSuccess}건 / 실패 ${totalFail}건`,
    });

    setSelectedRollbackItems(new Set());
    fetchHistory(historyPage);
    // Re-expand to refresh details
    const log = historyLogs.find((l) => l.id === logId);
    if (log) {
      // Will be refreshed from fetched data
      setExpandedLogId(null);
      setExpandedDetails([]);
    }

    setSelectiveRollingBack(false);
  }

  // ── Expand log details ────────────────────────────────────────
  function toggleExpand(log: BulkLogEntry) {
    if (expandedLogId === log.id) {
      setExpandedLogId(null);
      setExpandedDetails([]);
      setEditMode(false);
      setEditValues({});
      setSelectedRollbackItems(new Set());
      return;
    }
    const parsed = safeParseDetails(log.details);
    setExpandedDetails(parsed);
    setExpandedLogId(log.id);
    setEditMode(false);
    setEditValues({});
    setSelectedRollbackItems(new Set());
  }

  // ── Toggle rollback selection ──────────────────────────────────
  function toggleRollbackItem(companyName: string) {
    setSelectedRollbackItems((prev) => {
      const next = new Set(prev);
      if (next.has(companyName)) {
        next.delete(companyName);
      } else {
        next.add(companyName);
      }
      return next;
    });
  }

  // ── Batch edit mode ────────────────────────────────────────────
  function enterEditMode() {
    const values: Record<string, { blogCount: string; instaCount: string; homepageDone: boolean | null; videoDone: boolean | null }> = {};
    for (const d of expandedDetails) {
      if (d.status === "success" && d.companyId) {
        values[d.companyName] = {
          blogCount: d.blogCount != null ? String(d.blogCount) : "0",
          instaCount: d.instaCount != null ? String(d.instaCount) : "0",
          homepageDone: d.homepageDone ?? null,
          videoDone: d.videoDone ?? null,
        };
      }
    }
    setEditValues(values);
    setEditMode(true);
    setSelectedRollbackItems(new Set());
  }

  function cancelEditMode() {
    setEditMode(false);
    setEditValues({});
  }

  function updateEditValue(companyName: string, field: string, value: string | boolean | null) {
    setEditValues((prev) => ({
      ...prev,
      [companyName]: {
        ...prev[companyName],
        [field]: value,
      },
    }));
  }

  async function saveBatchEdit(logId: number) {
    setEditSaving(true);
    let saved = 0;
    let failed = 0;

    for (const d of expandedDetails) {
      if (d.status !== "success" || !d.companyId) continue;
      const ev = editValues[d.companyName];
      if (!ev) continue;

      // Check blogCount change
      const origBlog = d.blogCount != null ? Number(d.blogCount) : 0;
      const newBlog = Number(ev.blogCount) || 0;
      if (newBlog !== origBlog && newBlog >= 0) {
        try {
          const res = await fetch("/api/solutions/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ logId, companyName: d.companyName, field: "blogCount", oldValue: origBlog, newValue: newBlog }),
          });
          if (res.ok) saved++;
          else failed++;
        } catch { failed++; }
      }

      // Check instaCount change
      const origInsta = d.instaCount != null ? Number(d.instaCount) : 0;
      const newInsta = Number(ev.instaCount) || 0;
      if (newInsta !== origInsta && newInsta >= 0) {
        try {
          const res = await fetch("/api/solutions/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ logId, companyName: d.companyName, field: "instaCount", oldValue: origInsta, newValue: newInsta }),
          });
          if (res.ok) saved++;
          else failed++;
        } catch { failed++; }
      }
    }

    if (saved > 0 || failed > 0) {
      setMessage({
        type: failed === 0 ? "success" : "error",
        text: `수정 완료 -- 성공 ${saved}건${failed > 0 ? ` / 실패 ${failed}건` : ""}`,
      });
    }

    setEditMode(false);
    setEditValues({});
    setEditSaving(false);
    fetchHistory(historyPage);
    setExpandedLogId(null);
    setExpandedDetails([]);
  }

  // ── Reset ──────────────────────────────────────────────────────
  function handleReset() {
    setFile(null);
    setRows([]);
    setResults(null);
    setMessage(null);
    setSuccessCount(0);
    setFailCount(0);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Tab change: reset file ─────────────────────────────────────
  function handleTabChange(newTab: SolutionTab) {
    setTab(newTab);
    setFile(null);
    setRows([]);
    setResults(null);
    setMessage(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ── Preview table columns based on tab ─────────────────────────
  function getPreviewColumns(): { key: string; label: string }[] {
    const base = [
      { key: "companyName", label: "업체명" },
      { key: "representative", label: "대표자" },
    ];
    if (tab === "all") {
      return [
        ...base,
        { key: "blogCount", label: "블로그건수" },
        { key: "instaCount", label: "인스타건수" },
        { key: "homepageDone", label: "홈페이지완료" },
        { key: "videoDone", label: "영상완료" },
      ];
    }
    if (tab === "blog") return [...base, { key: "blogCount", label: "블로그건수" }];
    if (tab === "insta") return [...base, { key: "instaCount", label: "인스타건수" }];
    if (tab === "homepage") return [...base, { key: "homepageDone", label: "홈페이지완료" }];
    if (tab === "video") return [...base, { key: "videoDone", label: "영상완료" }];
    return base;
  }

  function getCellValue(row: ParsedRow, key: string): string {
    if (key === "companyName") return row.companyName;
    if (key === "representative") return row.representative || "-";
    if (key === "blogCount") return row.blogCount !== undefined ? String(row.blogCount) : "-";
    if (key === "instaCount") return row.instaCount !== undefined ? String(row.instaCount) : "-";
    if (key === "homepageDone") return boolToOX(row.homepageDone) || "-";
    if (key === "videoDone") return boolToOX(row.videoDone) || "-";
    return "-";
  }

  const columns = getPreviewColumns();

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div
      style={{
        padding: "24px",
        maxWidth: "1200px",
        margin: "0 auto",
        fontFamily: fontStack,
      }}
    >
      {/* ── Header ────────────────────────────────────────────── */}
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
          솔루션 일괄 등록
        </h1>
        <p style={{ fontSize: "13.5px", color: "#64748b", marginTop: "6px", marginBottom: 0 }}>
          엑셀 파일로 솔루션 진행 현황을 일괄 업데이트합니다. 숫자 건수는 기존 값에 누적 추가됩니다.
        </p>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "0",
          borderBottom: "2px solid #e2e8f0",
          marginBottom: "20px",
        }}
      >
        {TABS.map((t) => {
          const isActive = tab === t;
          return (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              style={{
                padding: "10px 20px",
                fontSize: "13.5px",
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "#8b5cf6" : "#64748b",
                backgroundColor: "transparent",
                border: "none",
                borderBottom: isActive ? "2px solid #8b5cf6" : "2px solid transparent",
                marginBottom: "-2px",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "color 0.15s, border-color 0.15s",
                whiteSpace: "nowrap",
              }}
            >
              {TAB_CONFIG[t].label}
            </button>
          );
        })}
      </div>

      {/* ── Pending Companies Section (개별 솔루션 탭에서만) ──── */}
      {tab !== 'all' && (
      <>
      <div style={{ ...cardStyle, borderLeft: '3px solid #f59e0b' }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a', marginBottom: 12 }}>
          미완료 업체 조회
          {userMgmtTeam && <span style={{ fontSize: 12, color: '#f59e0b', marginLeft: 8 }}>{pendingBranches.length === 6 ? '전체' : `${userMgmtTeam}팀`}</span>}
        </h2>

        {/* Month selector */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>대상 월:</label>
          <select
            value={pendingYearMonth}
            onChange={(e) => {
              setPendingYearMonth(e.target.value);
              setPendingCompanies([]);
            }}
            style={{ height: 32, padding: '0 8px', fontSize: 13, border: '1px solid #e2e8f0', background: '#fff', outline: 'none', cursor: 'pointer' }}
          >
            {(() => {
              const now = new Date();
              const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
              const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
              const nextYM = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
              const allMonths = [...new Set([...pendingAvailableMonths, curYM, nextYM])].sort().reverse();
              return allMonths.map(m => <option key={m} value={m}>{m}</option>);
            })()}
          </select>
        </div>

        {/* Branch checkboxes */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {['인천', '수원', '동탄', '용인', '부산', '본사'].map(b => {
            const selected = pendingBranches.includes(b);
            return (
              <label key={b} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: '1px solid', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                borderColor: selected ? '#f59e0b' : '#e2e8f0',
                background: selected ? '#fffbeb' : '#fff',
                color: selected ? '#d97706' : '#64748b',
              }}>
                <input type="checkbox" checked={selected}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...pendingBranches, b]
                      : pendingBranches.filter(v => v !== b);
                    setPendingBranches(next);
                  }}
                  style={{ accentColor: '#f59e0b' }} />
                {b}
              </label>
            );
          })}
        </div>

        <button onClick={fetchPending} disabled={pendingLoading || pendingBranches.length === 0}
          style={{ padding: '8px 16px', background: pendingBranches.length === 0 ? '#d1d5db' : '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: pendingBranches.length === 0 ? 'not-allowed' : 'pointer', marginBottom: 12, opacity: pendingLoading ? 0.6 : 1, fontFamily: 'inherit' }}>
          {pendingLoading ? '조회중...' : `미완료 업체 조회 (${TAB_CONFIG[tab].label})`}
        </button>

        {/* Results table */}
        {pendingCompanies.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
              <b>{pendingCompanies.length}건</b> 미완료
              <button onClick={generatePendingTemplate} style={{ marginLeft: 12, padding: '4px 12px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 4, fontSize: 12, cursor: 'pointer', color: '#7c3aed', fontFamily: 'inherit' }}>
                양식 자동생성
              </button>
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>업체명</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>대표자</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>지사</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>고유번호</th>
                  <th style={{ padding: '8px', textAlign: 'left', fontWeight: 600, color: '#64748b' }}>현재</th>
                </tr></thead>
                <tbody>
                  {pendingCompanies.map((c, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 500 }}>{c.companyName}</td>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>{c.representative}</td>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>{c.branch}</td>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>{c.placeId || '-'}</td>
                      <td style={{ padding: '6px 8px', color: '#475569' }}>{c.current}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      </>
      )}

      {/* ── Format Guide + Template Download ──────────────────── */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 3a1 1 0 110 2 1 1 0 010-2zm-1 4h2v5H9V9z"
              fill="#8b5cf6"
            />
          </svg>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
            양식 안내 -- {TAB_CONFIG[tab].label}
          </span>
        </div>

        <div
          style={{
            backgroundColor: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            padding: "12px 16px",
            marginBottom: "14px",
          }}
        >
          <div
            style={{
              fontSize: "13px",
              color: "#475569",
              lineHeight: 1.8,
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}
          >
            {TAB_CONFIG[tab].headers.join(" | ")}
          </div>
        </div>

        <div style={{ fontSize: "12.5px", color: "#64748b", lineHeight: 1.7 }}>
          <div style={{ marginBottom: "4px" }}>
            * <b>업체명</b>은 필수입니다. 동일 업체명이 여러 건이면 <b>대표자</b>로 구분합니다.
          </div>
          {(tab === "all" || tab === "blog" || tab === "insta") && (
            <div style={{ marginBottom: "4px" }}>
              * 숫자를 입력하면 기존 값에 추가됩니다. 비워두면 변경 없음.
            </div>
          )}
          {(tab === "all" || tab === "homepage" || tab === "video") && (
            <div style={{ marginBottom: "4px" }}>
              * 완료 여부는 <b>O</b>(완료) 또는 <b>X</b>(미완료)로 입력합니다.
            </div>
          )}
          <div>* 엑셀(.xlsx) 및 CSV 파일을 지원합니다.</div>
        </div>

        <div style={{ marginTop: "14px" }}>
          <button
            style={btnSecondary}
            onClick={downloadTemplate}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f1f5f9";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "#fff";
            }}
          >
            양식 다운로드
          </button>
        </div>
      </div>

      {/* ── File Upload Zone ──────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", margin: "0 0 16px 0" }}>
          파일 업로드
        </h2>

        <div
          style={{
            border: "2px dashed #d1d5db",
            borderRadius: 8,
            padding: "40px 20px",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "#f5f3ff" : "#fafafa",
            transition: "background 0.15s",
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) handleFileSelect(e.target.files[0]);
            }}
          />
          {file ? (
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a", marginBottom: "6px" }}>
                {file.name}
              </div>
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                {rows.length}건 파싱됨 (클릭하여 파일 변경)
              </div>
            </div>
          ) : (
            <div>
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                style={{ margin: "0 auto 10px", display: "block" }}
              >
                <path
                  d="M20 6v20m0-20l-7 7m7-7l7 7M8 28h24"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <div style={{ fontSize: "14px", color: "#475569", marginBottom: "6px" }}>
                파일을 드래그하거나 클릭하여 선택
              </div>
              <div style={{ fontSize: "12.5px", color: "#94a3b8" }}>엑셀(.xlsx) 또는 CSV</div>
            </div>
          )}
        </div>

        {/* ── Preview Table ────────────────────────────────────── */}
        {rows.length > 0 && (
          <div style={{ marginTop: "20px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "10px",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#475569" }}>
                미리보기 -- {rows.length}건 중 {checkedCount}건 선택됨
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  style={{
                    ...btnSecondary,
                    height: "30px",
                    padding: "0 12px",
                    fontSize: "12px",
                  }}
                  onClick={selectAll}
                >
                  전체 선택
                </button>
                <button
                  style={{
                    ...btnSecondary,
                    height: "30px",
                    padding: "0 12px",
                    fontSize: "12px",
                  }}
                  onClick={deselectAll}
                >
                  전체 해제
                </button>
              </div>
            </div>

            <div
              style={{
                maxHeight: "400px",
                overflowY: "auto",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    <th style={{ ...thStyle, width: "44px", textAlign: "center", padding: "10px 8px" }}>
                      <input
                        type="checkbox"
                        checked={checkedCount === rows.length && rows.length > 0}
                        onChange={() => {
                          if (checkedCount === rows.length) deselectAll();
                          else selectAll();
                        }}
                        style={{ cursor: "pointer", width: "15px", height: "15px", accentColor: "#8b5cf6" }}
                      />
                    </th>
                    <th style={{ ...thStyle, width: "44px", textAlign: "center", padding: "10px 8px" }}>
                      #
                    </th>
                    {columns.map((col) => (
                      <th key={col.key} style={thStyle}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr
                      key={i}
                      style={{
                        backgroundColor: row.checked ? "transparent" : "#f8fafc",
                        opacity: row.checked ? 1 : 0.5,
                      }}
                    >
                      <td style={{ ...tdStyle, textAlign: "center", padding: "10px 8px" }}>
                        <input
                          type="checkbox"
                          checked={row.checked}
                          onChange={() => toggleRow(i)}
                          style={{ cursor: "pointer", width: "15px", height: "15px", accentColor: "#8b5cf6" }}
                        />
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "center",
                          padding: "10px 8px",
                          color: "#94a3b8",
                          fontSize: "12px",
                        }}
                      >
                        {i + 1}
                      </td>
                      {columns.map((col) => (
                        <td key={col.key} style={tdStyle}>
                          {getCellValue(row, col.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Action Buttons ───────────────────────────────────── */}
        <div style={{ display: "flex", gap: "8px", marginTop: "18px", alignItems: "center" }}>
          <button
            style={{
              ...btnPurple,
              ...(submitting || checkedCount === 0 ? { opacity: 0.5, cursor: "not-allowed" } : {}),
            }}
            disabled={submitting || checkedCount === 0}
            onClick={handleSubmit}
            onMouseEnter={(e) => {
              if (!submitting && checkedCount > 0) e.currentTarget.style.backgroundColor = "#7c3aed";
            }}
            onMouseLeave={(e) => {
              if (!submitting && checkedCount > 0) e.currentTarget.style.backgroundColor = "#8b5cf6";
            }}
          >
            {submitting ? "처리 중..." : `등록 (${checkedCount}건)`}
          </button>
          {file && (
            <button
              style={btnSecondary}
              onClick={handleReset}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f1f5f9";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#fff";
              }}
            >
              초기화
            </button>
          )}
        </div>

        {message && !results && (
          <div
            style={{
              padding: "10px 14px",
              fontSize: "13px",
              borderRadius: "6px",
              marginTop: "12px",
              backgroundColor: message.type === "success" ? "#f0fdf4" : "#fef2f2",
              color: message.type === "success" ? "#15803d" : "#dc2626",
              border:
                message.type === "success" ? "1px solid #bbf7d0" : "1px solid #fecaca",
            }}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* ── Results Section ───────────────────────────────────── */}
      {results && (
        <div style={cardStyle}>
          {/* Summary header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "18px",
              flexWrap: "wrap",
              gap: "10px",
            }}
          >
            <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", margin: 0 }}>
              처리 결과
            </h2>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-block",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#15803d",
                  backgroundColor: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  padding: "5px 12px",
                  borderRadius: "6px",
                }}
              >
                성공 {successCount}건
              </span>
              {failCount > 0 && (
                <span
                  style={{
                    display: "inline-block",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#dc2626",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    padding: "5px 12px",
                    borderRadius: "6px",
                  }}
                >
                  실패 {failCount}건
                </span>
              )}
            </div>
          </div>

          {/* Message */}
          {message && (
            <div
              style={{
                padding: "10px 14px",
                fontSize: "13px",
                borderRadius: "6px",
                marginBottom: "16px",
                backgroundColor: message.type === "success" ? "#f0fdf4" : "#fef2f2",
                color: message.type === "success" ? "#15803d" : "#dc2626",
                border:
                  message.type === "success" ? "1px solid #bbf7d0" : "1px solid #fecaca",
              }}
            >
              {message.text}
            </div>
          )}

          {/* Results table */}
          <div
            style={{
              overflowX: "auto",
              border: "1px solid #e2e8f0",
              borderRadius: "6px",
              maxHeight: "400px",
              overflowY: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  <th style={thStyle}>업체명</th>
                  <th style={{ ...thStyle, width: "80px", textAlign: "center" }}>상태</th>
                  <th style={thStyle}>사유</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={i}
                    style={{
                      backgroundColor: r.status === "fail" ? "#fef2f2" : "transparent",
                    }}
                  >
                    <td style={tdStyle}>{r.companyName}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 10px",
                          fontSize: "12px",
                          fontWeight: 600,
                          borderRadius: "4px",
                          backgroundColor: r.status === "success" ? "#f0fdf4" : "#fef2f2",
                          color: r.status === "success" ? "#15803d" : "#dc2626",
                          border:
                            r.status === "success"
                              ? "1px solid #bbf7d0"
                              : "1px solid #fecaca",
                        }}
                      >
                        {r.status === "success" ? "성공" : "실패"}
                      </span>
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        color: r.status === "fail" ? "#dc2626" : "#64748b",
                      }}
                    >
                      {r.reason || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Action buttons: download results */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginTop: "16px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              style={btnSecondary}
              onClick={downloadResults}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#f1f5f9";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#fff";
              }}
            >
              결과 CSV 다운로드
            </button>
          </div>
        </div>
      )}

      {/* ── Divider ───────────────────────────────────────────── */}
      <div style={{ borderTop: "2px solid #e2e8f0", margin: "32px 0 24px" }} />

      {/* ── History Section (등록 이력) ───────────────────────── */}
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#0f172a", margin: 0 }}>
            등록 이력
          </h2>
          {historyTotal > 0 && (
            <span style={{ fontSize: "12px", color: "#94a3b8" }}>
              총 {historyTotal}건
            </span>
          )}
        </div>

        {historyLoading && historyLogs.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
            불러오는 중...
          </div>
        ) : historyLogs.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
            등록 이력이 없습니다.
          </div>
        ) : (
          <>
            <div
              style={{
                overflowX: "auto",
                border: "1px solid #e2e8f0",
                borderRadius: "6px",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>일시</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>유형</th>
                    <th style={thStyle}>업체</th>
                    <th style={thStyle}>등록자</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>성공</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>실패</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>상태</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLogs.map((log) => {
                    const parsedDetails = safeParseDetails(log.details);
                    const companySummary = summarizeCompanies(parsedDetails);
                    return (
                      <React.Fragment key={log.id}>
                        <tr style={{ borderBottom: expandedLogId === log.id ? "none" : undefined }}>
                          <td style={tdStyle}>{formatDateTime(log.createdAt)}</td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                                borderRadius: "4px",
                                backgroundColor: "#f5f3ff",
                                color: "#7c3aed",
                                border: "1px solid #ddd6fe",
                              }}
                            >
                              {TYPE_LABEL[log.type] || log.type}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis" }} title={companySummary}>
                            {companySummary}
                          </td>
                          <td style={tdStyle}>{log.user?.displayName || "-"}</td>
                          <td style={{ ...tdStyle, textAlign: "center", color: "#15803d", fontWeight: 600 }}>
                            {log.successCount}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              textAlign: "center",
                              color: log.failCount > 0 ? "#dc2626" : "#94a3b8",
                              fontWeight: 600,
                            }}
                          >
                            {log.failCount}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            {log.rolledBack ? (
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  borderRadius: "4px",
                                  backgroundColor: "#f1f5f9",
                                  color: "#94a3b8",
                                  textDecoration: "line-through",
                                }}
                              >
                                롤백됨
                              </span>
                            ) : (
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  borderRadius: "4px",
                                  backgroundColor: "#f0fdf4",
                                  color: "#15803d",
                                }}
                              >
                                완료
                              </span>
                            )}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "center" }}>
                            <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                              <button
                                style={btnSmall}
                                onClick={() => toggleExpand(log)}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = "#f1f5f9";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = "#fff";
                                }}
                              >
                                {expandedLogId === log.id ? "접기" : "상세"}
                              </button>
                              {!log.rolledBack && log.successCount > 0 && (
                                <button
                                  style={{
                                    ...btnSmall,
                                    color: "#dc2626",
                                    borderColor: "#fecaca",
                                    ...(rollingBackLogId === log.id ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                                  }}
                                  disabled={rollingBackLogId === log.id}
                                  onClick={() => handleRollbackLog(log.id)}
                                  onMouseEnter={(e) => {
                                    if (rollingBackLogId !== log.id) e.currentTarget.style.backgroundColor = "#fef2f2";
                                  }}
                                  onMouseLeave={(e) => {
                                    if (rollingBackLogId !== log.id) e.currentTarget.style.backgroundColor = "#fff";
                                  }}
                                >
                                  {rollingBackLogId === log.id ? "처리중..." : "롤백"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {/* ── Expanded details ──────────────────── */}
                        {expandedLogId === log.id && (
                          <tr key={`${log.id}-details`}>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <div
                                style={{
                                  backgroundColor: "#f8fafc",
                                  borderTop: "1px dashed #cbd5e1",
                                  borderBottom: "2px solid #e2e8f0",
                                  padding: "16px 20px",
                                  marginLeft: "12px",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>
                                    상세 내역 ({expandedDetails.length}건)
                                  </div>
                                  {!log.rolledBack && (
                                    <div style={{ display: "flex", gap: "6px" }}>
                                      {!editMode && (
                                        <>
                                          <button
                                            style={{
                                              ...btnSmall,
                                              color: "#dc2626",
                                              borderColor: "#fecaca",
                                              ...(selectedRollbackItems.size === 0 || selectiveRollingBack ? { opacity: 0.4, cursor: "not-allowed" } : {}),
                                            }}
                                            disabled={selectedRollbackItems.size === 0 || selectiveRollingBack}
                                            onClick={() => handleSelectiveRollback(log.id)}
                                          >
                                            {selectiveRollingBack ? "처리중..." : `선택 롤백 (${selectedRollbackItems.size})`}
                                          </button>
                                          <button
                                            style={{
                                              ...btnSmall,
                                              color: "#8b5cf6",
                                              borderColor: "#ddd6fe",
                                            }}
                                            onClick={enterEditMode}
                                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "#f5f3ff"; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "#fff"; }}
                                          >
                                            일괄 수정
                                          </button>
                                        </>
                                      )}
                                      {editMode && (
                                        <>
                                          <button
                                            style={{
                                              ...btnSmall,
                                              color: "#fff",
                                              backgroundColor: "#8b5cf6",
                                              border: "none",
                                              ...(editSaving ? { opacity: 0.5, cursor: "not-allowed" } : {}),
                                            }}
                                            disabled={editSaving}
                                            onClick={() => saveBatchEdit(log.id)}
                                          >
                                            {editSaving ? "저장중..." : "저장"}
                                          </button>
                                          <button
                                            style={btnSmall}
                                            onClick={cancelEditMode}
                                          >
                                            취소
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div
                                  style={{
                                    maxHeight: "350px",
                                    overflowY: "auto",
                                    border: "1px solid #e2e8f0",
                                    borderRadius: "6px",
                                    backgroundColor: "#fff",
                                  }}
                                >
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead>
                                      <tr>
                                        {!log.rolledBack && !editMode && (
                                          <th style={{ ...thStyle, fontSize: "11px", padding: "8px 10px", width: "40px", textAlign: "center" }}>선택</th>
                                        )}
                                        <th style={{ ...thStyle, fontSize: "11px", padding: "8px 10px" }}>업체명</th>
                                        <th style={{ ...thStyle, fontSize: "11px", padding: "8px 10px", textAlign: "center" }}>블로그</th>
                                        <th style={{ ...thStyle, fontSize: "11px", padding: "8px 10px", textAlign: "center" }}>인스타</th>
                                        <th style={{ ...thStyle, fontSize: "11px", padding: "8px 10px", textAlign: "center" }}>홈페이지</th>
                                        <th style={{ ...thStyle, fontSize: "11px", padding: "8px 10px", textAlign: "center" }}>영상</th>
                                        <th style={{ ...thStyle, fontSize: "11px", padding: "8px 10px", textAlign: "center" }}>상태</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {expandedDetails.map((d, idx) => {
                                        const isSuccess = d.status === "success";
                                        const isFail = d.status === "fail";
                                        const ev = editValues[d.companyName];

                                        return (
                                          <tr
                                            key={idx}
                                            style={{
                                              backgroundColor: isFail ? "#fef2f2" : "transparent",
                                              opacity: isFail ? 0.6 : 1,
                                            }}
                                          >
                                            {!log.rolledBack && !editMode && (
                                              <td style={{ ...tdStyle, fontSize: "12px", padding: "8px 10px", textAlign: "center" }}>
                                                {isSuccess ? (
                                                  <input
                                                    type="checkbox"
                                                    checked={selectedRollbackItems.has(d.companyName)}
                                                    onChange={() => toggleRollbackItem(d.companyName)}
                                                    style={{ cursor: "pointer", width: "14px", height: "14px", accentColor: "#dc2626" }}
                                                  />
                                                ) : null}
                                              </td>
                                            )}
                                            <td style={{ ...tdStyle, fontSize: "12px", padding: "8px 10px", color: isFail ? "#94a3b8" : "#0f172a" }}>
                                              {d.companyName}
                                            </td>
                                            {/* Blog */}
                                            <td style={{ ...tdStyle, fontSize: "12px", padding: "8px 10px", textAlign: "center" }}>
                                              {editMode && isSuccess && ev ? (
                                                <input
                                                  type="number"
                                                  min="0"
                                                  value={ev.blogCount}
                                                  onChange={(e) => updateEditValue(d.companyName, "blogCount", e.target.value)}
                                                  style={{
                                                    width: "50px",
                                                    height: "24px",
                                                    fontSize: "12px",
                                                    textAlign: "center",
                                                    border: "1px solid #8b5cf6",
                                                    borderRadius: "3px",
                                                    outline: "none",
                                                  }}
                                                />
                                              ) : d.blogCount != null && Number(d.blogCount) > 0 ? (
                                                <span style={{ color: isFail ? "#94a3b8" : "#15803d" }}>+{d.blogCount}</span>
                                              ) : (
                                                <span style={{ color: "#94a3b8" }}>-</span>
                                              )}
                                            </td>
                                            {/* Insta */}
                                            <td style={{ ...tdStyle, fontSize: "12px", padding: "8px 10px", textAlign: "center" }}>
                                              {editMode && isSuccess && ev ? (
                                                <input
                                                  type="number"
                                                  min="0"
                                                  value={ev.instaCount}
                                                  onChange={(e) => updateEditValue(d.companyName, "instaCount", e.target.value)}
                                                  style={{
                                                    width: "50px",
                                                    height: "24px",
                                                    fontSize: "12px",
                                                    textAlign: "center",
                                                    border: "1px solid #8b5cf6",
                                                    borderRadius: "3px",
                                                    outline: "none",
                                                  }}
                                                />
                                              ) : d.instaCount != null && Number(d.instaCount) > 0 ? (
                                                <span style={{ color: isFail ? "#94a3b8" : "#15803d" }}>+{d.instaCount}</span>
                                              ) : (
                                                <span style={{ color: "#94a3b8" }}>-</span>
                                              )}
                                            </td>
                                            {/* Homepage */}
                                            <td style={{ ...tdStyle, fontSize: "12px", padding: "8px 10px", textAlign: "center" }}>
                                              {editMode && isSuccess && ev ? (
                                                <button
                                                  onClick={() => updateEditValue(d.companyName, "homepageDone", ev.homepageDone === true ? false : ev.homepageDone === false ? null : true)}
                                                  style={{
                                                    ...btnSmall,
                                                    height: "24px",
                                                    padding: "0 8px",
                                                    fontSize: "11px",
                                                    color: ev.homepageDone === true ? "#15803d" : ev.homepageDone === false ? "#dc2626" : "#94a3b8",
                                                    fontWeight: 600,
                                                    borderColor: ev.homepageDone === true ? "#bbf7d0" : ev.homepageDone === false ? "#fecaca" : "#e2e8f0",
                                                  }}
                                                >
                                                  {ev.homepageDone === true ? "O" : ev.homepageDone === false ? "X" : "-"}
                                                </button>
                                              ) : d.homepageDone != null ? (
                                                <span style={{ color: isFail ? "#94a3b8" : d.homepageDone ? "#15803d" : "#94a3b8" }}>
                                                  {d.homepageDone ? "O" : "X"}
                                                </span>
                                              ) : (
                                                <span style={{ color: "#94a3b8" }}>-</span>
                                              )}
                                            </td>
                                            {/* Video */}
                                            <td style={{ ...tdStyle, fontSize: "12px", padding: "8px 10px", textAlign: "center" }}>
                                              {editMode && isSuccess && ev ? (
                                                <button
                                                  onClick={() => updateEditValue(d.companyName, "videoDone", ev.videoDone === true ? false : ev.videoDone === false ? null : true)}
                                                  style={{
                                                    ...btnSmall,
                                                    height: "24px",
                                                    padding: "0 8px",
                                                    fontSize: "11px",
                                                    color: ev.videoDone === true ? "#15803d" : ev.videoDone === false ? "#dc2626" : "#94a3b8",
                                                    fontWeight: 600,
                                                    borderColor: ev.videoDone === true ? "#bbf7d0" : ev.videoDone === false ? "#fecaca" : "#e2e8f0",
                                                  }}
                                                >
                                                  {ev.videoDone === true ? "O" : ev.videoDone === false ? "X" : "-"}
                                                </button>
                                              ) : d.videoDone != null ? (
                                                <span style={{ color: isFail ? "#94a3b8" : d.videoDone ? "#15803d" : "#94a3b8" }}>
                                                  {d.videoDone ? "O" : "X"}
                                                </span>
                                              ) : (
                                                <span style={{ color: "#94a3b8" }}>-</span>
                                              )}
                                            </td>
                                            {/* Status */}
                                            <td style={{ ...tdStyle, fontSize: "12px", padding: "8px 10px", textAlign: "center" }}>
                                              {log.rolledBack ? (
                                                <span style={{ color: "#94a3b8", textDecoration: "line-through", fontWeight: 600 }}>롤백됨</span>
                                              ) : isSuccess ? (
                                                <span
                                                  style={{
                                                    display: "inline-block",
                                                    padding: "1px 8px",
                                                    fontSize: "11px",
                                                    fontWeight: 600,
                                                    borderRadius: "4px",
                                                    backgroundColor: "#f0fdf4",
                                                    color: "#15803d",
                                                    border: "1px solid #bbf7d0",
                                                  }}
                                                >
                                                  성공
                                                </span>
                                              ) : (
                                                <span
                                                  style={{
                                                    display: "inline-flex",
                                                    alignItems: "center",
                                                    gap: "4px",
                                                    padding: "1px 8px",
                                                    fontSize: "11px",
                                                    fontWeight: 600,
                                                    borderRadius: "4px",
                                                    backgroundColor: "#fef2f2",
                                                    color: "#dc2626",
                                                    border: "1px solid #fecaca",
                                                  }}
                                                  title={d.reason || ""}
                                                >
                                                  실패
                                                  {d.reason && (
                                                    <span style={{ fontWeight: 400, fontSize: "10px", color: "#ef4444" }}>
                                                      ({d.reason})
                                                    </span>
                                                  )}
                                                </span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {historyTotalPages > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "8px",
                  marginTop: "12px",
                }}
              >
                <button
                  style={{
                    ...btnSmall,
                    ...(historyPage <= 1 ? { opacity: 0.4, cursor: "not-allowed" } : {}),
                  }}
                  disabled={historyPage <= 1 || historyLoading}
                  onClick={() => fetchHistory(historyPage - 1)}
                >
                  이전
                </button>
                <span style={{ fontSize: "12px", color: "#475569" }}>
                  {historyPage} / {historyTotalPages}
                </span>
                <button
                  style={{
                    ...btnSmall,
                    ...(historyPage >= historyTotalPages ? { opacity: 0.4, cursor: "not-allowed" } : {}),
                  }}
                  disabled={historyPage >= historyTotalPages || historyLoading}
                  onClick={() => fetchHistory(historyPage + 1)}
                >
                  다음
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
