/*
 * data.js — 소방공무원 승진 점수 계산기 기준 데이터 (근거 원문 기반)
 *
 * 근거:
 *  - 소방공무원 승진임용 규정(대통령령 제35641호, 시행 2025.7.8) 제9조·제10조·제11조
 *  - 소방공무원 승진임용 규정 시행규칙(행정안전부령) 제7조·제13조·제19조 및 별표3(개정 2024.1.11)
 *  - 소방공무원 교육훈련성적 평정규정(소방청예규 제117호, 시행 2026.1.1) 제11조·제12조
 *
 * 계급 순서(높은→낮은): 소방정 > 소방령 > 소방경 > 소방위 > 소방장 > 소방교 > 소방사
 */

// 명부 반영 비율(영 제11조): 근무성적 70% / 경력 15%(소방정 20%) / 교육훈련 15%(소방정 10%)
// 각 항목 원점수 만점(시행규칙·영) → 명부 환산.
//  · 근무성적 원점수 60점 → 명부 70점  (×70/60)
//  · 경력 원점수 25점(소방정 30) → 명부 15점(소방정 20)  (×15/25, 소방정 ×20/30)
//  · 교육훈련 원점수 15점(소방정 10) → 명부 15점(소방정 10)  (×1)

const RANKS = ["소방정", "소방령", "소방경", "소방위", "소방장", "소방교", "소방사"];

// 경력평정 별표3: 월별점수 × 근무월수(기간상한 내), 소수점 셋째자리에서 반올림, 만점 상한.
const CAREER = {
  소방정: { base:{ perMonth:0.722, months:36, max:26 }, over:{ perMonth:0.167, months:24, max:4 } },
  소방령: { base:{ perMonth:0.611, months:36, max:22 }, over:{ perMonth:0.062, months:48, max:3 } },
  소방경: { base:{ perMonth:0.611, months:36, max:22 }, over:{ perMonth:0.083, months:36, max:3 } },
  소방위: { base:{ perMonth:0.917, months:24, max:22 }, over:{ perMonth:0.083, months:36, max:3 } },
  소방장: { base:{ perMonth:0.917, months:24, max:22 }, over:{ perMonth:0.250, months:12, max:3 } },
  소방교: { base:{ perMonth:1.222, months:18, max:22 }, over:{ perMonth:0.500, months:6,  max:3 } },
  소방사: { base:{ perMonth:1.222, months:18, max:22 }, over:{ perMonth:0.500, months:6,  max:3 } },
};

// 명부 반영 비율/환산
function rankWeights(rank){
  const isJeong = rank === "소방정";
  return {
    work:   { rawMax:60, boonMax:70, factor:70/60 },
    career: { rawMax:isJeong?30:25, boonMax:isJeong?20:15, factor:isJeong?20/30:15/25 },
    edu:    { rawMax:isJeong?10:15, boonMax:isJeong?10:15, factor:1 },
  };
}

// 근무성적 명부 산정 평정 횟수(시행규칙 제19조③) — 안내용
const WORK_ROUNDS = { 소방정:6, 소방령:4, 소방경:4, 소방위:4, 소방장:4, 소방교:2, 소방사:2 };

// 교육훈련성적 구성(영 제10조②). 계급별로 항목·만점·평정횟수가 다름.
//  drill = 직장훈련(4점), fitness = 체력검정(5점), edu = 전문교육훈련(3점),
//  mgmt = 관리역량교육(3점), policy = 소방정책관리자교육(10점), pro = 전문능력(3점)
const EDU_COMPOSITION = {
  소방정: { policy:{max:10} },
  소방령: { mgmt:{max:3}, edu:{max:3}, drill:{max:4, rounds:4}, fitness:{max:5, rounds:2} },
  소방경: { mgmt:{max:3}, edu:{max:3}, drill:{max:4, rounds:4}, fitness:{max:5, rounds:2} },
  소방위: { mgmt:{max:3}, edu:{max:3}, drill:{max:4, rounds:4}, fitness:{max:5, rounds:2} },
  소방장: { edu:{max:3}, drill:{max:4, rounds:4}, fitness:{max:5, rounds:2}, pro:{max:3} },
  소방교: { edu:{max:3}, drill:{max:4, rounds:2}, fitness:{max:5, rounds:1}, pro:{max:3} },
  소방사: { edu:{max:3}, drill:{max:4, rounds:2}, fitness:{max:5, rounds:1}, pro:{max:3} },
};

// 전문교육훈련성적(예규 제11조) 합계 3점 만점. 하위 상한 존재.
const PRO_EDU = {
  max: 3,
  sinim: 2.5,            // 신임교육과정(소방사 현 계급)
  hourRate: 0.04,        // 전문교육 시간당(반일 4시간 이상)
  outsourceCap: 1.0,     // 외부위탁 직무전문교육 총 상한
  cyberPerCourse: 0.25,  // 사이버 과정당
  cyberCap: 1.0,         // 사이버 총 상한
};

// 전문능력성적(예규 제12조) — 소방장 이하만. 합계 3점 만점.
const PRO_ABILITY = {
  max: 3,
  // 소방사: 취득시점 무관(현 계급 요건 예외), 각 1.5점
  소방사: {
    현계급요건: false,
    items: [
      { id:"license1", name:"제1종 대형운전면허", point:1.5 },
      { id:"emt2", name:"응급구조사 2급(또는 1급) 또는 간호사", point:1.5 },
    ],
  },
  // 소방교·소방장 공통 목록: 현 계급 취득 요건 O
  소방교장: {
    현계급요건: true,
    // 가목 1.5점
    ga: [
      { id:"emt2", name:"응급구조사 2급", point:1.5 },
      { id:"sf_ind_m", name:"소방설비산업기사(기계)", point:1.5 },
      { id:"sf_ind_e", name:"소방설비산업기사(전기)", point:1.5 },
      { id:"haz_craft", name:"위험물기능사(또는 위험물산업기사)", point:1.5 },
      { id:"car_ind", name:"자동차정비산업기사(또는 자동차정비기사)", point:1.5 },
      { id:"fireresp1", name:"화재대응능력평가(1급)", point:1.5 },
      { id:"rescue2", name:"인명구조사(2급)", point:1.5 },
      { id:"invest_ind", name:"화재감식평가산업기사", point:1.5 },
    ],
    // 나목 3점
    na: [
      { id:"emt1", name:"응급구조사 1급", point:3 },
      { id:"nurse", name:"간호사", point:3 },
      { id:"sf_eng_m", name:"소방설비기사(기계)", point:3 },
      { id:"sf_eng_e", name:"소방설비기사(전기)", point:3 },
      { id:"haz_master", name:"위험물기능장", point:3 },
      { id:"car_master", name:"자동차정비기능장", point:3 },
      { id:"safe_edu", name:"소방안전교육사", point:3 },
      { id:"investigator", name:"화재조사관", point:3 },
      { id:"fac_manager", name:"소방시설관리사", point:3 },
      { id:"pe", name:"소방기술사", point:3 },
      { id:"rescue1", name:"인명구조사(1급)", point:3 },
      { id:"invest_eng", name:"화재감식평가기사", point:3 },
    ],
  },
};

// 법령 원문 링크(국가법령정보센터)
const REG_LINKS = {
  bonus: "https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000098087",  // 소방공무원 가점평정 규정
  edu:   "https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=2100000207346",  // 소방공무원 교육훈련성적 평정규정
  rule:  "https://www.law.go.kr/법령/소방공무원승진임용규정시행규칙",           // 시행규칙
};

/* 가점(별도, 합계 5점 이내). 시행규칙 제15조의2 + 소방공무원 가점평정 규정.
 * 항목별 상한: 자격증(전산+직무) 0.5 / 학위·어학 0.5 / 격무·기피 2.0 / 대회·평가 2.0 / 인사교류 3.0. */
const BONUS_TOTAL = 5.0;

// ① 자격증 가점 (별표1 전산 + 별표2 직무), 합산 상한 0.5점. 현 계급 취득분만.
const CERT_BONUS = {
  cap: 0.5,
  // 별표1 전산능력 (소방경 이하만)
  computer: [
    { id:"comp1", name:"컴퓨터활용능력 1급", point:0.5 },
    { id:"comp2", name:"컴퓨터활용능력 2급", point:0.3 },
    { id:"word",  name:"워드프로세서", point:0.3 },
  ],
  // 별표2 직무 자격증 — 등급(배점)별 선택
  jobTiers: [
    { point:0.5, desc:"기술사·기능장(해당 분야), 1~4급 항해·기관·운항사, 운송용·사업용조종사·항공(공장)정비사, 응급구조사1급, 간호사, 화재조사관, 소방시설관리사, 소방안전교육사, 전문인명구조사, 건축사, 제1종 대형운전면허" },
    { point:0.3, desc:"기사(해당 분야), 5·6급 항해·기관사, 응급구조사2급, 화재대응능력평가1급, 인명구조사1급" },
    { point:0.2, desc:"산업기사·기능사(해당 분야), 소형선박조종사, 잠수산업기사·잠수기능사, 화재대응능력평가2급, 인명구조사2급" },
  ],
};

// ② 학위 (제6조). 같은 종류는 가장 높은 학위 1개만. 전문학사·학사는 소방경 이하만.
const DEGREE_BONUS = {
  items: [
    { id:"assoc",  name:"전문학사", point:0.1, gyeonghyoOnly:true },
    { id:"bach",   name:"학사",     point:0.2, gyeonghyoOnly:true },
    { id:"master", name:"석사",     point:0.3 },
    { id:"phd",    name:"박사",     point:0.5 },
  ],
};

// ③ 어학 (별표3). 점수 이상이면 해당 배점. 학위와 합산 상한 0.5점.
const LANG_BONUS = {
  degreeLangCap: 0.5, // 학위+어학 합산 상한
  tests: [
    { id:"toeic", name:"TOEIC",              bands:[[870,0.5],[790,0.3],[730,0.2]] },
    { id:"toefl", name:"TOEFL iBT",          bands:[[99,0.5],[90,0.3],[78,0.2]] },
    { id:"teps",  name:"TEPS(구)",           bands:[[800,0.5],[700,0.3],[630,0.2]] },
    { id:"lang2", name:"제2외국어(서울대·한국외대 검정)", bands:[[80,0.5],[70,0.3],[60,0.2]] },
  ],
};

// ④ 격무·기피부서 (제7조①). 6개월 초과분에 대해 1개월당 0.05점, 상한 2.0점. 휴직기간 제외.
const HARDSHIP_BONUS = { freeMonths: 6, perMonth: 0.05, cap: 2.0 };

// ⑤ 대회·평가 우수(우수실적) 상한 2.0, ⑥ 인사교류 상한 3.0 — 소방청장/시도지사 기준(직접 입력)
const CONTEST_CAP = 2.0;
const EXCHANGE_CAP = 3.0;

if (typeof module !== "undefined") {
  module.exports = { RANKS, CAREER, rankWeights, WORK_ROUNDS, EDU_COMPOSITION, PRO_EDU, PRO_ABILITY,
    REG_LINKS, BONUS_TOTAL, CERT_BONUS, DEGREE_BONUS, LANG_BONUS, HARDSHIP_BONUS, CONTEST_CAP, EXCHANGE_CAP };
}
if (typeof window !== "undefined") {
  Object.assign(window, { RANKS, CAREER, rankWeights, WORK_ROUNDS, EDU_COMPOSITION, PRO_EDU, PRO_ABILITY,
    REG_LINKS, BONUS_TOTAL, CERT_BONUS, DEGREE_BONUS, LANG_BONUS, HARDSHIP_BONUS, CONTEST_CAP, EXCHANGE_CAP });
}
