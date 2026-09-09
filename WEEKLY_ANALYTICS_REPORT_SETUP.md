# REDUCT 매주 금요일 10시 웹 유입/검색 리포트

ChatGPT 자동 작업은 매주 금요일 오전 10시(Asia/Seoul) 실행되도록 설정되어 있습니다. 수신: ceo@reduct.co.kr

## 리포트 항목
- 최근 7일 사용자/세션 및 국가별 유입
- 평균 참여시간 또는 세션 체류시간
- 주요 랜딩페이지 / 유입경로
- Google 자연검색 검색어, 클릭, 노출, CTR, 평균순위
- 직전 7일 대비 증감
- 가능하면 Vercel 보안/스캐너 이상징후

## 데이터 연결이 필요한 이유
검색 키워드는 Google Search Console, 체류시간·국가·세션은 GA4가 가장 정확합니다. 현재 웹사이트 코드에는 GA4 Measurement ID가 없으므로 실제 체류시간/세션 데이터를 만들려면 GA4를 생성·연결해야 합니다.

권장 연결: ChatGPT의 GSC Wizard 플러그인에 Google Search Console과 연결된 GA4 property를 연결합니다. 연결 전에는 자동 리포트가 숫자를 임의 생성하지 않고 연결 필요 안내만 발송하도록 설정되어 있습니다.
