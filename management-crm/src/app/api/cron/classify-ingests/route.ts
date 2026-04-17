import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyCronKey } from '@/lib/notification-sender';
import { classifyIngest } from '@/lib/classify-ingest';
import { ensureCaseGrouped } from '@/lib/risk-group';

// POST /api/cron/classify-ingests — 미처리 Gmail ingest를 자동 분류 후 RiskCase 생성
// 10분마다 호출 (Gmail 폴링 크론 직후)

export async function POST(request: Request) {
  if (!verifyCronKey(request)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const results = { processed: 0, created: 0, skipped: 0, unclassified: 0, errors: 0 };

  try {
    // 미처리 ingest 조회 (최대 100건)
    const ingests = await prisma.riskGmailIngest.findMany({
      where: { linkedCaseId: null, classified: false },
      orderBy: { receivedAt: 'asc' },
      take: 100,
      select: {
        id: true,
        subject: true,
        fromAddress: true,
        bodySnippet: true,
        bodyText: true,
        receivedAt: true,
        messageId: true,
      },
    });

    for (const ingest of ingests) {
      results.processed++;
      try {
        const result = classifyIngest(ingest);

        if (result.skip) {
          // 무시할 메일 (보안알림 등) — classified만 true로
          await prisma.riskGmailIngest.update({
            where: { id: ingest.id },
            data: { classified: true, suggestedType: null, processedAt: new Date() },
          });
          results.skipped++;
          continue;
        }

        if (!result.caseType) {
          // 분류 불가 — classified=true로 마크하되 linkedCaseId는 null
          await prisma.riskGmailIngest.update({
            where: { id: ingest.id },
            data: { classified: true, processedAt: new Date() },
          });
          results.unclassified++;
          continue;
        }

        // 같은 messageId로 이미 케이스가 있는지 확인 (중복 방지)
        const existingCase = await prisma.riskCase.findFirst({
          where: { sourceEmailId: ingest.messageId },
          select: { id: true },
        });
        if (existingCase) {
          await prisma.riskGmailIngest.update({
            where: { id: ingest.id },
            data: { classified: true, linkedCaseId: existingCase.id, processedAt: new Date() },
          });
          results.skipped++;
          continue;
        }

        // RiskCase 생성
        const created = await prisma.$transaction(async (tx) => {
          const riskCase = await tx.riskCase.create({
            data: {
              caseType: result.caseType!,
              businessName: result.businessName || ingest.subject.slice(0, 60),
              status: 'pending',
              receivedAt: ingest.receivedAt,
              source: 'gmail',
              sourceEmailId: ingest.messageId,
              sourceEmailFrom: ingest.fromAddress,
              sourceEmailSubject: ingest.subject,
              additionalInfo: ingest.bodySnippet.slice(0, 500),
            },
          });

          await tx.riskGmailIngest.update({
            where: { id: ingest.id },
            data: {
              classified: true,
              suggestedType: result.caseType,
              linkedCaseId: riskCase.id,
              processedAt: new Date(),
            },
          });

          await tx.riskCaseLog.create({
            data: {
              caseId: riskCase.id,
              actorId: 1, // system
              action: 'create',
              toValue: 'pending',
              note: 'Gmail 자동 분류',
            },
          });

          await ensureCaseGrouped(tx, riskCase.id);
          return riskCase;
        });

        if (created) results.created++;
      } catch (err) {
        console.error('[classify-ingests] error for ingest', ingest.id, err);
        results.errors++;
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error('POST /api/cron/classify-ingests error:', error);
    return NextResponse.json({ message: '분류 실패', error: String(error) }, { status: 500 });
  }
}
