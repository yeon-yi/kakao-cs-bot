import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'OpenPLAT - 고객 응대 자동화 플랫폼';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 60%, #1e3a5f 100%)',
          position: 'relative',
        }}
      >
        {/* Grid pattern overlay */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            opacity: 0.05,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Left accent bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 6,
            display: 'flex',
            background: 'linear-gradient(180deg, #2563eb, #0891b2)',
          }}
        />

        {/* Content */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '80px 100px',
            width: '100%',
          }}
        >
          {/* Logo */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginBottom: 48,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #2563eb, #0891b2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 24,
                fontWeight: 800,
              }}
            >
              O
            </div>
            <span
              style={{
                fontSize: 42,
                fontWeight: 800,
                color: 'white',
                letterSpacing: '-0.02em',
              }}
            >
              OpenPLAT
            </span>
          </div>

          {/* Title */}
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: 'white',
              lineHeight: 1.3,
              marginBottom: 24,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>고객 응대</span>
            <span>자동화 플랫폼</span>
          </div>

          {/* Description */}
          <div
            style={{
              fontSize: 22,
              color: '#94a3b8',
              lineHeight: 1.6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <span>카카오톡 기반 CS 자동 응답 시스템 관리</span>
          </div>

          {/* Feature tags */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 40,
            }}
          >
            {['실시간 모니터링', '지식 베이스', '자동 분류'].map((tag) => (
              <div
                key={tag}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  background: 'rgba(37, 99, 235, 0.15)',
                  border: '1px solid rgba(37, 99, 235, 0.3)',
                  color: '#60a5fa',
                  fontSize: 16,
                  fontWeight: 500,
                  display: 'flex',
                }}
              >
                {tag}
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div
          style={{
            position: 'absolute',
            bottom: 40,
            right: 80,
            display: 'flex',
            color: '#475569',
            fontSize: 16,
          }}
        >
          (주)모집 관리팀
        </div>
      </div>
    ),
    { ...size },
  );
}
