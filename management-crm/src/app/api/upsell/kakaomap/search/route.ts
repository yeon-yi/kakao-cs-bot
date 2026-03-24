import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requireUpsellAuth } from '@/lib/upsell-auth';

const KAKAO_REST_API_KEY = process.env.KAKAO_REST_API_KEY || '';

// GET /api/upsell/kakaomap/search — 카카오맵 업체 검색
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const query = request.nextUrl.searchParams.get('q')?.trim();
    if (!query || query.length < 2) {
      return NextResponse.json({ places: [], message: '검색어를 2자 이상 입력하세요.' });
    }

    // Kakao Local API 키워드 검색
    if (KAKAO_REST_API_KEY) {
      const kakaoUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=15`;
      const res = await fetch(kakaoUrl, {
        headers: { Authorization: `KakaoAK ${KAKAO_REST_API_KEY}` },
      });

      if (res.ok) {
        const data = await res.json();
        const places = (data.documents || []).map((doc: {
          id: string;
          place_name: string;
          category_name: string;
          road_address_name: string;
          address_name: string;
          phone: string;
          place_url: string;
        }) => ({
          id: doc.id,
          name: doc.place_name,
          category: doc.category_name,
          address: doc.road_address_name || doc.address_name,
          phone: doc.phone,
          url: doc.place_url,
        }));
        return NextResponse.json({ places, count: places.length });
      }
    }

    // Kakao API 키가 없거나 실패한 경우 안내 메시지
    if (!KAKAO_REST_API_KEY) {
      return NextResponse.json({
        places: [],
        count: 0,
        message: '카카오 API 키가 설정되지 않았습니다. URL을 직접 입력하세요.',
      });
    }

    // Fallback: 카카오맵 웹 스크래핑
    const places = await searchKakaoMapWeb(query);
    if (places.length === 0 || !places[0].name) {
      return NextResponse.json({
        places: [],
        count: 0,
        message: '검색 결과가 없습니다. 카카오맵 URL을 직접 입력하세요.',
      });
    }
    return NextResponse.json({ places, count: places.length });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/kakaomap/search error:', error);
    return NextResponse.json({ message: '검색 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** Fallback: 카카오맵 웹 검색 스크래핑 */
async function searchKakaoMapWeb(query: string) {
  try {
    const url = `https://map.kakao.com/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });

    if (!res.ok) return [];

    const html = await res.text();
    const places: { id: string; name: string; category: string; address: string; phone: string; url: string }[] = [];

    // place.map.kakao.com/{id} 패턴 추출
    const idMatches = html.matchAll(/place\.map\.kakao\.com\/(\d+)/g);
    const seenIds = new Set<string>();

    for (const match of idMatches) {
      const id = match[1];
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      places.push({
        id,
        name: '',
        category: '',
        address: '',
        phone: '',
        url: `https://place.map.kakao.com/${id}`,
      });
    }

    return places.slice(0, 10);
  } catch {
    return [];
  }
}
