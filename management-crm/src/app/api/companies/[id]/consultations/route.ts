import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthPayload } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Role-based access check for company
async function checkCompanyAccess(companyId: number, auth: AuthPayload) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return { error: '업체를 찾을 수 없습니다.', status: 404 };
  if (auth.role === 'manager' && company.branch !== auth.branch)
    return { error: '접근 권한이 없습니다.', status: 403 };
  if (auth.role === 'staff' && company.staffName !== auth.displayName)
    return { error: '접근 권한이 없습니다.', status: 403 };
  return null;
}

// GET /api/companies/[id]/consultations — List consultations for a company
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    const { id } = await params;
    const companyId = parseInt(id);

    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 업체 ID입니다.' }, { status: 400 });
    }

    const accessErr = await checkCompanyAccess(companyId, auth);
    if (accessErr) return NextResponse.json({ message: accessErr.error }, { status: accessErr.status });

    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

    const [consultations, total] = await Promise.all([
      prisma.consultation.findMany({
        where: { companyId },
        include: {
          user: { select: { id: true, displayName: true } },
        },
        orderBy: { contactDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.consultation.count({ where: { companyId } }),
    ]);

    return NextResponse.json({
      consultations,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/companies/[id]/consultations error:', error);
    return NextResponse.json({ message: '상담 이력 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/companies/[id]/consultations — Create a new consultation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    const { id } = await params;
    const companyId = parseInt(id);

    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 업체 ID입니다.' }, { status: 400 });
    }

    const accessErr = await checkCompanyAccess(companyId, auth);
    if (accessErr) return NextResponse.json({ message: accessErr.error }, { status: accessErr.status });

    const body = await request.json();
    const { contactDate, contactType, content, nextContactDate, nextAction } = body;

    // Validate required fields
    if (!contactDate) {
      return NextResponse.json({ message: '상담 일자를 입력해주세요.' }, { status: 400 });
    }
    if (!contactType?.trim()) {
      return NextResponse.json({ message: '상담 유형을 선택해주세요.' }, { status: 400 });
    }
    if (!content?.trim()) {
      return NextResponse.json({ message: '상담 내용을 입력해주세요.' }, { status: 400 });
    }

    const consultation = await prisma.consultation.create({
      data: {
        companyId,
        userId: auth.userId,
        contactDate: new Date(contactDate),
        contactType: contactType.trim(),
        content: content.trim(),
        nextContactDate: nextContactDate ? new Date(nextContactDate) : null,
        nextAction: nextAction?.trim() || null,
      },
      include: {
        user: { select: { id: true, displayName: true } },
      },
    });

    return NextResponse.json({ consultation }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/companies/[id]/consultations error:', error);
    return NextResponse.json({ message: '상담 이력 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
