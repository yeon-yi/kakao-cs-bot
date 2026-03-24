'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const btnStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    fontSize: 13,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    background: disabled ? '#f9fafb' : '#fff',
    color: disabled ? '#cbd5e1' : '#374151',
    cursor: disabled ? 'default' : 'pointer',
    minHeight: 38,
    fontFamily: 'inherit',
  });

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 16, flexWrap: 'wrap' }}>
      <button disabled={page === 1} onClick={() => onPageChange(1)} style={btnStyle(page === 1)}>
        {'<<'}
      </button>
      <button disabled={page === 1} onClick={() => onPageChange(page - 1)} style={btnStyle(page === 1)}>
        이전
      </button>
      <span style={{ padding: '8px 16px', fontSize: 13, color: '#64748b', fontWeight: 500 }}>
        {page} / {totalPages}
      </span>
      <button disabled={page === totalPages} onClick={() => onPageChange(page + 1)} style={btnStyle(page === totalPages)}>
        다음
      </button>
      <button disabled={page === totalPages} onClick={() => onPageChange(totalPages)} style={btnStyle(page === totalPages)}>
        {'>>'}
      </button>
    </div>
  );
}
