# plan: 공개 규제 현황 카드 (국가출하승인 + 한국 GMP)

- 기능 ID: 021
- 상태: 구현 중 (1차: FR-001~004·006·007. FR-005 "QA 확인 요청" 버튼은 별도 승인 뒤)
- 버전: v0.1
- 작성일 / 최종 갱신: 2026-10-28 / 2026-10-28
- 근거 문서: docs/specs/021-…/spec.md v0.2

## 0. 요약
새 라이브러리·DB 변경 없이 서버 함수 2개(GMP, 국가출하승인), 규칙 파일 1개, 제품 상세 칸 1개를 더한다. 시험 자료는 spec 019의 시험 모드에 얹는다.

## 1. 기술과 버전
- 기존 스택 그대로(빌드 없는 ES 모듈, Vercel 함수 Node). 새 라이브러리 없음.
- 인증키: 허가정보·회수와 같은 `DATA_GO_KR_SERVICE_KEY` 하나. 국가출하승인만 포털 문서에 요청변수 이름이 `ServiceKey`라 `fetchPublicData`에 `keyParam` 선택값을 더했다(기본 `serviceKey`).

## 2. 구조와 파일
| 파일 | 하는 일 |
|---|---|
| `src/domain/regulatory-rules.js` | 업체명 맞춤, GMP 한 줄·가장 늦은 유효기간·남은 일수·단계(180일), 승인 이력 거르기, QA 확인 필요 계산 (순수 함수) |
| `api/gmp.js` | `?name=업체명` → GMP 적합판정서 (`BSSH_NM`) |
| `api/shipment.js` | `?name=제품명` → 뒤 5쪽(500건)을 한꺼번에 받아 제품명으로 거름, 훑은 건수(`scanned`) 포함 |
| `api/_public-data.js` | `keyParam` 선택값 추가 |
| `api/_fixture-mode.js` | GMP·승인 시험 자료 고르기, 승인은 첫 쪽에만 자료 |
| `fixtures/public/gmp-*.json`, `shipment-*.json` | 시험 자료 8개 (모두 "(시험 자료)") |
| `src/ui/pages/product-regulatory.js` | "공개 규제 현황" 칸 (승인 칸, GMP 칸, QA 확인 필요 배지) |
| `src/domain/regulatory-review.js` | 비교·종합 규칙: 회수 대조(`recalledLots`)·종합 한 줄(`overallReview`)·업체명 대조(`companyCheck`)·일정 대조(`scheduleCheck`)·승인 추이(`approvalTrend`)·GMP 전체(`gmpRowsFor`) (FR-008~013). 파일 상한(300줄) 때문에 `regulatory-rules.js`에서 나눔 |
| `src/ui/pages/regulatory-views.js` | 탭의 화면 조각(종합 목록, 업체명·일정 표, GMP 전체 표, 승인 목록·추이). 부르기는 `product-regulatory.js` |
| `src/infrastructure/store-work-orders.js` | `listProductWorkOrders`: 이 제품의 진행 전·진행 중 작업지시를 읽기만 함 (FR-011) |
| `src/ui/pages/products.js` | 제품 상세에 "공개 규제 현황" 탭(`?tab=regulatory`) 추가 |
| `src/ui/dom.js`, `styles/public.css` | 배지 톤 2개, 작은 제목 글자 |

## 3. 단계별 접근
1. 규칙 시험 → 규칙 (완료)
2. API 시험 → 서버 함수 2개 (완료)
3. 시험 자료 + 시험 모드 확장 + 자료 시험 (완료)
4. 화면 칸 (완료, 시험 자료로 임시 확인 페이지에서 확인)
5. 문서 갱신 (이 단계)
6. 유○○의 첫 실제 호출로 응답 구조 확정 (미완료)
7. FR-005 버튼 (별도 승인)

## 4. 테스트 전략
- `tests/regulatory-rules.test.js` 9개: 업체명 맞춤, 남은 일수 경계(0·180·181), 최근순 3건, QA 확인 필요 조건
- `tests/regulatory-api.test.js` 7개: 업체명·제품명 검사, 키 이름, 1쪽+뒤 5쪽, 뒤쪽 실패, 키 비노출
- `tests/regulatory-fixtures.test.js` 5개: 시험 자료 제품 3종의 결과, 검색어로 고르는 GMP 자료 5종
- 화면은 시험 자료로 임시 확인 페이지에서 눈으로 확인 (qa.md)

## 5. 제약과 주의점
- 응답 JSON 구조(header/body)는 허가정보·회수와 같다고 가정한다. 다르면 `fetchPublicData`가 안전한 오류로 처리한다(502). 첫 실제 호출에서 확정한다.
- 국가출하승인은 제품명으로 못 거르므로 뒤 500건 안에서만 찾는다(`shortcut` 주석). 정렬 순서는 첫 실제 호출에서 확인하고, 범위(조회한 건수·전체 건수)는 칸에 적는다.
- 시험 자료의 GMP 임박 날짜(2027-01-31)는 날짜가 흐르면 "여유"→"임박"→"지남"으로 바뀐다. 시험은 오늘 날짜를 직접 넣어 고정했다.

## 변경 기록
| 날짜 | 버전 | 바뀐 내용 |
|---|---|---|
| 2026-10-28 | v0.1 | 처음 작성 (spec v0.2 승인 직후 구현하며 같이 씀) |
