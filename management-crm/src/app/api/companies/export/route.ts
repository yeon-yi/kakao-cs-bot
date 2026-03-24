import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const VIDEO_LABELS: Record<string, string> = { none: '없음', premium: '프리미엄', short: '숏폼' };

// GET /api/companies/export — CSV export
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};
    if (auth.branch) where.branch = auth.branch;
    if (auth.role === 'manager') where.managerName = auth.displayName;
    else if (auth.role === 'staff') where.staffName = auth.displayName;

    const companies = await prisma.company.findMany({
      where,
      include: { setting: true, progress: true },
      orderBy: [{ paymentDate: 'desc' }, { sourceId: 'desc' }],
    });

    const BOM = '\uFEFF';
    const header = '결제일,지사,업체명,대표자,연락처,담당자,간부,계약시작,계약종료,홀딩,리워드,블로그(현재/목표),인스타(현재/목표),홈페이지,영상,솔루션상태';

    const rows = companies.map((c) => {
      const s = c.setting;
      const p = c.progress;

      let status = '미설정';
      if (s) {
        if (s.isHolding) {
          status = '홀딩';
        } else if (p) {
          const allDone =
            (!s.hasReward || p.rewardDone) &&
            (s.blogTarget <= 0 || p.blogCount >= s.blogTarget) &&
            (s.instaTarget <= 0 || p.instaCount >= s.instaTarget) &&
            (!s.hasHomepage || p.homepageDone) &&
            (s.videoType === 'none' || p.videoDone);
          status = allDone ? '완료' : '진행중';
        } else {
          status = '설정됨';
        }
      }

      return [
        fmtDate(c.paymentDate),
        c.branch || '',
        esc(c.companyName),
        esc(c.representative),
        c.phone,
        esc(c.staffName),
        esc(c.managerName),
        s?.contractStart ? fmtDate(s.contractStart) : '',
        s?.contractEnd ? fmtDate(s.contractEnd) : '',
        s?.isHolding ? 'O' : '',
        s?.hasReward ? (p?.rewardDone ? '완료' : '미완료') : '미해당',
        s && s.blogTarget > 0 ? `${p?.blogCount ?? 0}/${s.blogTarget}` : '미해당',
        s && s.instaTarget > 0 ? `${p?.instaCount ?? 0}/${s.instaTarget}` : '미해당',
        s?.hasHomepage ? (p?.homepageDone ? '완료' : '미완료') : '미해당',
        s?.videoType && s.videoType !== 'none' ? `${VIDEO_LABELS[s.videoType] ?? s.videoType} ${p?.videoDone ? '완료' : '미완료'}` : '미해당',
        status,
      ].join(',');
    });

    const csv = BOM + header + '\n' + rows.join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="companies_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/companies/export error:', error);
    return NextResponse.json({ message: '내보내기 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function fmtDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().split('T')[0];
}

function esc(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
