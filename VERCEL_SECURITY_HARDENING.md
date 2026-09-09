# REDUCT Vercel 보안 설정 — 배포 후 필수

코드 레벨 보안은 이 패키지에 반영되어 있습니다. 아래 항목은 Vercel Edge Firewall 설정이라 GitHub 코드만으로 켤 수 없습니다.

## 1. Bot Protection
Vercel Dashboard → Project → Security / Firewall → Bot Protection을 ON으로 설정합니다.

## 2. Custom Rule 권장값
프로젝트 루트에서 Vercel CLI가 연결되어 있다면 다음 규칙을 추가할 수 있습니다. 규칙 생성 후 `vercel firewall publish`로 게시합니다.

### A. 폼/API 과다 요청 제한
```bash
vercel firewall rules add "REDUCT - Rate limit contact API" \
  --condition '{"type":"path","op":"pre","value":"/api/contact"}' \
  --action rate_limit \
  --rate-limit-window 60 \
  --rate-limit-requests 10 \
  --rate-limit-keys ip \
  --rate-limit-action challenge --yes
```

### B. 흔한 취약점 스캐너 경로 차단
대시보드 Custom Rule에서 아래 경로들을 OR 조건으로 묶고 Action = Deny로 설정합니다.
- `/.env`
- `/.git`
- `/wp-admin`
- `/wp-login.php`
- `/xmlrpc.php`
- `/phpmyadmin`
- `/vendor/phpunit`
- `/server-status`
- `/actuator`
- `/cgi-bin`

### C. 비정상적인 전체 요청 폭주 완화
정상 사용자보다 훨씬 높은 기준으로 전체 사이트를 제한합니다.
- Path prefix: `/`
- 60초당 300회 / IP
- 초과 시 Challenge

검색엔진 크롤러와 정상 사용자를 과도하게 막지 않도록 300/분보다 낮게 시작하지 않는 것을 권장합니다.

## 3. Allowed 요청 419건 점검
Security → Firewall → Traffic에서 Action = Allowed로 필터링 후 다음을 확인합니다.
- `/.env`, `/.git`, `wp-login`, `xmlrpc`, `phpmyadmin`, `cgi-bin`, `actuator` 요청 존재 여부
- 동일 IP가 짧은 시간에 수십~수백 URL을 순회했는지
- 404/403 경로를 반복 호출하는 User-Agent
- POST/PUT/PATCH/DELETE 등 현재 사이트에 필요하지 않은 메서드 반복 여부

단순 GET/HEAD로 정상 페이지, robots.txt, sitemap.xml, 이미지/CSS/JS를 읽은 요청은 Allowed여도 정상입니다.

## 4. Attack Mode
Attack Mode는 상시 ON용이 아닙니다. 실제 공격이 발생하거나 요청량이 급증할 때 1~24시간 임시 활성화합니다.

```bash
vercel firewall attack-mode enable --duration 1h --yes
# 종료
vercel firewall attack-mode disable --yes
```

## 이 패키지에 이미 반영된 항목
- HSTS 2년 + preload
- CSP 강화
- clickjacking 차단
- MIME sniffing 차단
- Referrer / Permissions Policy
- Cross-Origin 정책 강화
- `/api/*` no-store + noindex
- 문의/진단 폼 서버 검증
- Origin/Referer 검증
- Honeypot
- 최소 제출 시간 검증
- 입력 길이/형식 제한
- URL spam 제한
- 서버 함수 단위 best-effort IP rate limit
- `.well-known/security.txt`
- 404 noindex 페이지

> 주의: 서버 함수 내부 rate limit은 warm instance 단위의 보조 방어입니다. 실질적인 Edge rate limit은 Vercel Firewall 규칙을 반드시 같이 사용해야 합니다.
