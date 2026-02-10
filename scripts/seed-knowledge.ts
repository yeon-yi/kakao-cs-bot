/**
 * 지식 시드 데이터 등록 스크립트
 * 실행: npx tsx scripts/seed-knowledge.ts
 */

const API_URL = process.env.API_URL || 'https://carefree-analysis-production-7389.up.railway.app';

const knowledgeData = [
  // ========== 네이버 트래픽/리워드 ==========
  {
    question: '네이버 트래픽 작업이 뭔가요?',
    answer: '네이버 트래픽 작업은 네이버 검색 또는 플레이스에서 특정 키워드로 유입량을 늘려주는 서비스입니다. 실제 사용자 패턴과 유사하게 검색, 클릭, 체류 등의 행동을 통해 자연스러운 트래픽을 만들어 드립니다.',
    category: '네이버트래픽',
    tier: 1,
    tags: ['네이버', '트래픽', '리워드', '유입'],
  },
  {
    question: '트래픽 작업 비용은 얼마인가요?',
    answer: '트래픽 작업 비용은 키워드 난이도, 일일 유입량, 작업 기간에 따라 달라집니다. 기본 패키지는 일 100~500 유입 기준이며, 정확한 견적은 키워드 분석 후 안내드립니다. 상담을 통해 맞춤 견적을 받아보세요.',
    category: '네이버트래픽',
    tier: 1,
    tags: ['비용', '견적', '트래픽'],
  },
  {
    question: '트래픽 작업 효과는 언제부터 나타나나요?',
    answer: '트래픽 작업은 보통 시작 후 3~7일 이내에 순위 변동이 나타나기 시작합니다. 키워드 경쟁도에 따라 2~4주 정도 지속적으로 작업해야 안정적인 순위 유지가 가능합니다.',
    category: '네이버트래픽',
    tier: 1,
    tags: ['효과', '기간', '순위'],
  },
  {
    question: '트래픽 작업하면 페널티 받지 않나요?',
    answer: '저희는 실제 사용자 행동 패턴을 기반으로 자연스러운 트래픽을 생성하기 때문에 페널티 리스크를 최소화합니다. 급격한 유입 증가가 아닌 점진적 증가 방식으로 진행하며, 다년간의 노하우로 안전하게 운영하고 있습니다.',
    category: '네이버트래픽',
    tier: 1,
    tags: ['페널티', '안전', '리스크'],
  },

  // ========== 블로그 기자단 배포 ==========
  {
    question: '블로그 기자단이 뭔가요?',
    answer: '블로그 기자단은 다수의 블로거가 고객님의 업체/서비스를 방문 또는 체험한 후 솔직한 리뷰 포스팅을 작성하는 서비스입니다. 자사 기자단을 직접 운영하고 있어 품질 관리가 철저하며, 네이버 블로그 상위 노출에 효과적입니다.',
    category: '블로그기자단',
    tier: 1,
    tags: ['블로그', '기자단', '리뷰', '포스팅'],
  },
  {
    question: '블로그 기자단 몇 명까지 가능한가요?',
    answer: '자사 기자단 인원은 약 200명 이상이며, 캠페인 규모에 따라 5명부터 50명 이상까지 배정 가능합니다. 업종, 지역, 블로거 등급(일방문자수)에 따라 맞춤 배정해 드립니다.',
    category: '블로그기자단',
    tier: 1,
    tags: ['블로그', '인원', '기자단'],
  },
  {
    question: '블로그 포스팅 한 건당 비용은?',
    answer: '블로그 포스팅 비용은 블로거 등급(일방문자수)과 포스팅 퀄리티에 따라 차등 적용됩니다. 일반 블로거 기준과 파워블로거 기준이 다르며, 정확한 단가는 상담 시 안내드립니다.',
    category: '블로그기자단',
    tier: 1,
    tags: ['블로그', '비용', '단가'],
  },
  {
    question: '블로그 기자단 진행 기간은 얼마나 걸리나요?',
    answer: '기자단 모집부터 포스팅 발행까지 보통 2~3주 소요됩니다. 방문 체험이 필요한 경우 일정 조율에 따라 추가 시간이 소요될 수 있습니다. 급한 건은 별도 협의 가능합니다.',
    category: '블로그기자단',
    tier: 1,
    tags: ['기간', '일정', '블로그'],
  },

  // ========== 인스타그램 게시물 ==========
  {
    question: '인스타그램 게시물 작업은 어떤 건가요?',
    answer: '인스타그램 피드 게시물, 릴스, 스토리 등을 기획/제작/게시하는 서비스입니다. 브랜드 톤에 맞는 이미지와 카피를 제작하고, 해시태그 전략까지 포함하여 인스타그램 마케팅을 대행합니다.',
    category: '인스타그램',
    tier: 1,
    tags: ['인스타', '게시물', 'SNS', '대행'],
  },
  {
    question: '인스타 팔로워 늘리기도 가능한가요?',
    answer: '인스타그램 팔로워 증가는 자연스러운 콘텐츠 마케팅과 해시태그 전략을 통해 유기적으로 성장시키는 방향으로 진행합니다. 단순 팔로워 구매는 계정 리스크가 크므로 권장하지 않으며, 콘텐츠 기반 성장 전략을 추천드립니다.',
    category: '인스타그램',
    tier: 1,
    tags: ['인스타', '팔로워', '성장'],
  },
  {
    question: '인스타 콘텐츠 월 몇 건 제작해주나요?',
    answer: '기본 패키지 기준 월 8~12건 피드 게시물 + 2~4건 릴스를 제작합니다. 고객님 업종과 목표에 따라 커스텀 패키지도 구성 가능합니다. 상세한 내용은 상담 시 안내드립니다.',
    category: '인스타그램',
    tier: 1,
    tags: ['인스타', '콘텐츠', '제작', '패키지'],
  },

  // ========== 반응형 홈페이지 제작 ==========
  {
    question: '홈페이지 제작 비용은 얼마인가요?',
    answer: '반응형 홈페이지 제작 비용은 페이지 수와 기능에 따라 달라집니다. 기본 랜딩페이지(1~3페이지)부터 기업 소개 사이트(5~10페이지), 쇼핑몰까지 다양한 범위를 다룹니다. 정확한 견적은 요구사항 파악 후 안내드립니다.',
    category: '홈페이지',
    tier: 1,
    tags: ['홈페이지', '비용', '반응형', '제작'],
  },
  {
    question: '홈페이지 제작 기간은 얼마나 걸리나요?',
    answer: '기본 반응형 홈페이지는 2~4주, 기능이 포함된 사이트는 4~8주 정도 소요됩니다. 디자인 시안 확정, 콘텐츠 준비 상황에 따라 일정이 달라질 수 있습니다.',
    category: '홈페이지',
    tier: 1,
    tags: ['홈페이지', '기간', '일정'],
  },
  {
    question: '모바일에서도 잘 보이나요?',
    answer: '네, 모든 홈페이지를 반응형(Responsive)으로 제작합니다. PC, 태블릿, 모바일 어떤 기기에서든 최적화된 화면으로 보이며, 모바일 우선 디자인으로 진행합니다.',
    category: '홈페이지',
    tier: 1,
    tags: ['홈페이지', '반응형', '모바일'],
  },
  {
    question: '홈페이지 유지보수도 해주나요?',
    answer: '네, 제작 완료 후 기본 1개월 무상 유지보수를 제공합니다. 이후에는 월 유지보수 계약을 통해 콘텐츠 수정, 서버 관리, 보안 업데이트 등을 지속 지원합니다.',
    category: '홈페이지',
    tier: 1,
    tags: ['홈페이지', '유지보수', '관리'],
  },

  // ========== SEO 작업 ==========
  {
    question: 'SEO가 뭔가요?',
    answer: 'SEO(Search Engine Optimization)는 검색엔진 최적화로, 네이버/구글에서 특정 키워드 검색 시 고객님의 사이트가 상위에 노출되도록 하는 작업입니다. 기술적 SEO, 콘텐츠 SEO, 링크 빌딩 등을 종합적으로 진행합니다.',
    category: 'SEO',
    tier: 1,
    tags: ['SEO', '검색엔진', '최적화', '상위노출'],
  },
  {
    question: 'SEO 작업 효과는 언제 나타나나요?',
    answer: 'SEO는 보통 1~3개월부터 효과가 나타나기 시작하며, 6개월 이상 꾸준히 진행해야 안정적인 상위 순위를 유지할 수 있습니다. 키워드 경쟁도와 현재 사이트 상태에 따라 차이가 있습니다.',
    category: 'SEO',
    tier: 1,
    tags: ['SEO', '효과', '기간'],
  },
  {
    question: 'SEO와 트래픽 작업의 차이가 뭔가요?',
    answer: 'SEO는 사이트 자체의 구조, 콘텐츠, 외부 링크 등을 최적화하여 검색엔진이 자연스럽게 상위 노출시키도록 하는 장기적 전략입니다. 트래픽 작업은 직접적으로 유입을 만들어 단기적 순위 상승을 돕습니다. 두 가지를 병행하면 시너지 효과가 큽니다.',
    category: 'SEO',
    tier: 1,
    tags: ['SEO', '트래픽', '차이', '비교'],
  },

  // ========== 영상 촬영 ==========
  {
    question: '영상 촬영 서비스는 어떤 건가요?',
    answer: '업체 소개 영상, 제품 홍보 영상, 인터뷰 영상, 유튜브/릴스용 숏폼 영상 등을 기획부터 촬영, 편집까지 원스톱으로 대행합니다. 전문 영상 제작팀과 협업하여 고퀄리티 결과물을 제공합니다.',
    category: '영상촬영',
    tier: 1,
    tags: ['영상', '촬영', '편집', '제작'],
  },
  {
    question: '영상 촬영 비용은 얼마인가요?',
    answer: '영상 종류와 길이에 따라 달라집니다. 숏폼(30초~1분)은 비교적 합리적인 가격이며, 기업 소개 영상(3~5분)은 기획/촬영/편집 포함하여 견적이 산출됩니다. 정확한 비용은 촬영 규모 파악 후 안내드립니다.',
    category: '영상촬영',
    tier: 1,
    tags: ['영상', '비용', '견적'],
  },

  // ========== 일반/공통 ==========
  {
    question: '상담은 어떻게 받을 수 있나요?',
    answer: '카카오톡 채팅방에서 바로 상담 가능합니다. 원하시는 서비스와 간단한 업체 정보를 말씀해 주시면 담당자가 빠르게 안내드리겠습니다. 전화 상담도 가능합니다.',
    category: '일반',
    tier: 1,
    tags: ['상담', '문의', '연락'],
  },
  {
    question: '계약은 어떻게 진행되나요?',
    answer: '상담 → 견적서 발행 → 계약서 서명 → 착수금 입금 → 작업 시작 순서로 진행됩니다. 전자계약서로 간편하게 처리 가능하며, 세금계산서 발행도 됩니다.',
    category: '일반',
    tier: 1,
    tags: ['계약', '진행', '절차'],
  },
  {
    question: '세금계산서 발행 되나요?',
    answer: '네, 세금계산서 발행 가능합니다. 사업자등록증을 보내주시면 작업 완료 후 또는 매월 정산 시 전자세금계산서를 발행해 드립니다.',
    category: '일반',
    tier: 1,
    tags: ['세금계산서', '정산', '결제'],
  },
  {
    question: '여러 서비스를 패키지로 할인받을 수 있나요?',
    answer: '네, 2개 이상 서비스를 동시에 진행하시면 패키지 할인이 적용됩니다. 예를 들어 블로그 기자단 + 네이버 트래픽, 홈페이지 제작 + SEO 등 조합하시면 할인된 가격으로 제안드립니다.',
    category: '일반',
    tier: 1,
    tags: ['패키지', '할인', '묶음'],
  },
];

async function main() {
  // 1. 로그인해서 토큰 받기
  console.log('로그인 중...');
  const loginRes = await fetch(`${API_URL}/trpc/auth.login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: { username: 'admin', password: 'admin123!' } }),
  });

  if (!loginRes.ok) {
    console.error('로그인 실패:', await loginRes.text());
    process.exit(1);
  }

  const loginData = await loginRes.json();
  const token = loginData.result?.data?.json?.token;
  if (!token) {
    console.error('토큰을 받지 못했습니다:', JSON.stringify(loginData));
    process.exit(1);
  }
  console.log('로그인 성공!\n');

  // 2. 지식 등록
  let success = 0;
  let fail = 0;

  for (const item of knowledgeData) {
    try {
      const res = await fetch(`${API_URL}/trpc/knowledge.add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ json: item }),
      });

      const data = await res.json();
      if (data.result?.data?.json?.success) {
        success++;
        console.log(`✓ [${item.category}] ${item.question}`);
      } else {
        fail++;
        console.error(`✗ [${item.category}] ${item.question}`, data.error || data);
      }
    } catch (err) {
      fail++;
      console.error(`✗ [${item.category}] ${item.question}`, err);
    }

    // API 부하 방지 (임베딩 생성에 시간 필요)
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n완료: 성공 ${success}건, 실패 ${fail}건 (총 ${knowledgeData.length}건)`);
}

main().catch(console.error);
