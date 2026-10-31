-- spec 018 2단계 (plan 018 §2): 검체 상태에 "폐기" 하나만 더한다.
-- enum 값은 더한 거래 안에서 쓸 수 없어 0034와 나눈다 (0031과 같은 방식). 기존 값·자료는 바꾸지 않는다.
alter type public.sample_status add value if not exists 'disposed';
