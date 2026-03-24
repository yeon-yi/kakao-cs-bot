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

// GET /api/companies/[id]/memos
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

    const memos = await prisma.companyMemo.findMany({
      where: { companyId },
      include: { user: { select: { id: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Include userId for frontend delete button visibility
    const result = memos.map((m) => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt,
      userId: m.userId,
      user: m.user,
    }));

    return NextResponse.json({ memos: result });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/companies/[id]/memos error:', error);
    return NextResponse.json({ message: '메모 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/companies/[id]/memos
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
    const content = body.content?.trim();

    if (!content) {
      return NextResponse.json({ message: '메모 내용을 입력해주세요.' }, { status: 400 });
    }

    const memo = await prisma.companyMemo.create({
      data: { companyId, userId: auth.userId, content },
      include: { user: { select: { id: true, displayName: true } } },
    });

    return NextResponse.json({ memo: { id: memo.id, content: memo.content, createdAt: memo.createdAt, userId: memo.userId, user: memo.user } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/companies/[id]/memos error:', error);
    return NextResponse.json({ message: '메모 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// DELETE /api/companies/[id]/memos?memoId=N
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    const { id } = await params;
    const companyId = parseInt(id);
    const memoId = parseInt(request.nextUrl.searchParams.get('memoId') || '');

    if (isNaN(companyId) || isNaN(memoId)) {
      return NextResponse.json({ message: '유효하지 않은 ID입니다.' }, { status: 400 });
    }

    const memo = await prisma.companyMemo.findUnique({ where: { id: memoId } });
    if (!memo) {
      return NextResponse.json({ message: '메모를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Verify memo belongs to this company
    if (memo.companyId !== companyId) {
      return NextResponse.json({ message: '잘못된 요청입니다.' }, { status: 400 });
    }

    // Only author or admin can delete
    if (memo.userId !== auth.userId && auth.role !== 'admin') {
      return NextResponse.json({ message: '삭제 권한이 없습니다.' }, { status: 403 });
    }

    await prisma.companyMemo.delete({ where: { id: memoId } });
    return NextResponse.json({ message: '삭제되었습니다.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('DELETE /api/companies/[id]/memos error:', error);
    return NextResponse.json({ message: '메모 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
