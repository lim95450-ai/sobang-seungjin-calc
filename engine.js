/*
 * engine.js — 순수 계산 로직 (브라우저/Node 공용). data.js의 상수를 사용.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    const D = require("./data.js");
    module.exports = factory(D);
  } else {
    root.Engine = factory({
      RANKS: root.RANKS, CAREER: root.CAREER, rankWeights: root.rankWeights,
      WORK_ROUNDS: root.WORK_ROUNDS, EDU_COMPOSITION: root.EDU_COMPOSITION,
      PRO_EDU: root.PRO_EDU, PRO_ABILITY: root.PRO_ABILITY,
      CERT_BONUS: root.CERT_BONUS, DEGREE_BONUS: root.DEGREE_BONUS, LANG_BONUS: root.LANG_BONUS,
      HARDSHIP_BONUS: root.HARDSHIP_BONUS, CONTEST_CAP: root.CONTEST_CAP, EXCHANGE_CAP: root.EXCHANGE_CAP,
      BONUS_TOTAL: root.BONUS_TOTAL,
    });
  }
})(typeof self !== "undefined" ? self : this, function (D) {
  const { CAREER, rankWeights, EDU_COMPOSITION, PRO_EDU, PRO_ABILITY,
    CERT_BONUS, DEGREE_BONUS, LANG_BONUS, HARDSHIP_BONUS, CONTEST_CAP, EXCHANGE_CAP, BONUS_TOTAL } = D;

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100; // 소수 셋째자리 반올림
  const round3 = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // 두 날짜 사이 경력월수(시행규칙 제10조③: 15일 이상 1월, 15일 미만 불산입)
  // 제외기간(월)이 있으면 차감.
  function careerMonths(startISO, baseISO, excludeMonths) {
    if (!startISO || !baseISO) return 0;
    const s = new Date(startISO), b = new Date(baseISO);
    if (isNaN(s) || isNaN(b) || b <= s) return 0;
    let months = (b.getFullYear() - s.getFullYear()) * 12 + (b.getMonth() - s.getMonth());
    let dayDiff = b.getDate() - s.getDate();
    if (dayDiff < 0) {
      months -= 1;
      // 남은 일수 = 전월 기준 잔여일
      const prev = new Date(b.getFullYear(), b.getMonth(), 0).getDate(); // 직전 달의 마지막 날
      dayDiff += prev;
    }
    if (dayDiff >= 15) months += 1;
    months -= Math.max(0, Math.round(excludeMonths || 0));
    return Math.max(0, months);
  }

  // 경력평정점(원점수). rank + 총 경력월수 → {기본, 초과, 합계, max}
  function careerScore(rank, totalMonths) {
    const c = CAREER[rank];
    const baseM = Math.min(totalMonths, c.base.months);
    const overM = Math.min(Math.max(totalMonths - c.base.months, 0), c.over.months);
    // 별표3 비고: 월별점수×근무월수(셋째자리 반올림). 기간을 다 채우면 별표의 기간별 만점을 적용.
    const basePt = baseM >= c.base.months ? c.base.max : Math.min(round2(c.base.perMonth * baseM), c.base.max);
    const overPt = overM >= c.over.months ? c.over.max : Math.min(round2(c.over.perMonth * overM), c.over.max);
    return {
      baseMonths: baseM, overMonths: overM,
      base: basePt, over: overPt,
      total: round2(basePt + overPt),
      max: c.base.max + c.over.max,
    };
  }

  // 전문교육훈련성적(예규 제11조). 입력: {sinim(bool), proHours, outsourceHours, cyberCourses}
  function proEduScore(rank, inp) {
    inp = inp || {};
    let sum = 0;
    const parts = {};
    if (rank === "소방사" && inp.sinim) { parts.sinim = PRO_EDU.sinim; sum += PRO_EDU.sinim; }
    if (inp.proHours) { const v = round2(inp.proHours * PRO_EDU.hourRate); parts.pro = v; sum += v; }
    if (inp.outsourceHours) { const v = Math.min(round2(inp.outsourceHours * PRO_EDU.hourRate), PRO_EDU.outsourceCap); parts.outsource = v; sum += v; }
    if (inp.cyberCourses) { const v = Math.min(round2(inp.cyberCourses * PRO_EDU.cyberPerCourse), PRO_EDU.cyberCap); parts.cyber = v; sum += v; }
    return { parts, total: Math.min(round2(sum), PRO_EDU.max), max: PRO_EDU.max };
  }

  // 전문능력성적(예규 제12조). 소방장 이하만. 입력: selectedIds(배열), acquiredMap {id:bool 현계급취득}
  // 소방사: 취득시점 무관. 소방교/소방장: 현 계급 취득 자격만 인정, 제2항 조합배점과 비교해 유리한 값.
  function proAbilityScore(rank, selectedIds, acquiredMap) {
    selectedIds = selectedIds || [];
    acquiredMap = acquiredMap || {};
    const max = PRO_ABILITY.max;
    if (rank === "소방사") {
      const items = PRO_ABILITY.소방사.items;
      let sum = 0; const got = [];
      items.forEach(it => { if (selectedIds.includes(it.id)) { sum += it.point; got.push(it.name); } });
      return { total: Math.min(round2(sum), max), max, detail: got };
    }
    if (rank === "소방교" || rank === "소방장") {
      const cfg = PRO_ABILITY.소방교장;
      // 현 계급 취득한 것만 인정
      const valid = selectedIds.filter(id => acquiredMap[id]);
      const isNa = id => cfg.na.some(x => x.id === id);
      const isGa = id => cfg.ga.some(x => x.id === id);
      const ptOf = id => (cfg.na.find(x=>x.id===id)||cfg.ga.find(x=>x.id===id)||{point:0}).point;
      // 제1항: 단순 합산(가1.5/나3). 라목: 나목 보유시 동종 하위 가목 제외는 UI에서 안내.
      const sum1 = valid.reduce((a,id)=>a+ptOf(id),0);
      // 제2항: 조합 배점(더 유리할 때). 보유 개수 기준.
      const cnt = valid.length;
      let combo = 0;
      // 제2항제2호(상위군: 나목류) 개수 기준
      const naCnt = valid.filter(isNa).length;
      if (naCnt >= 4) combo = 3; else if (naCnt === 3) combo = 2.5; else if (naCnt === 2) combo = 2;
      // 제2항제1호(전체군) 개수 기준
      let combo1 = 0;
      if (cnt >= 6) combo1 = 3; else if (cnt === 5) combo1 = 2.5; else if (cnt === 4) combo1 = 2; else if (cnt === 3) combo1 = 1.5;
      const best = Math.max(sum1, combo, combo1);
      return { total: Math.min(round2(best), max), max, detail: valid.map(id=> (cfg.na.find(x=>x.id===id)||cfg.ga.find(x=>x.id===id)||{}).name).filter(Boolean) };
    }
    return { total: 0, max, detail: [] };
  }

  // 최고 등급 소방경 이하 여부(전문학사·학사, 전산 자격증은 소방경 이하만)
  const isGyeonghyoIha = (rank) => !["소방정","소방령"].includes(rank); // 소방경 이하

  // 어학 점수 → 배점
  function langPoint(testId, score) {
    const t = (LANG_BONUS.tests || []).find(x => x.id === testId);
    if (!t || !score) return 0;
    for (const [th, p] of t.bands) { if (Number(score) >= th) return p; }
    return 0;
  }

  // 가점(별도 5점). 새 구조 입력(model.bonus):
  //  { cert:{computer,jobTier,현계급취득}, degree:{ids[],현계급취득}, lang:{test,score,현계급취득},
  //    hardship:{start,end,exclude}, contest:{value,현계급취득}, exchange:{value} }
  function bonusScore(rank, b) {
    b = b || {};
    const parts = {};

    // ① 자격증(전산+직무) 상한 0.5, 현 계급 취득분만. 전산은 소방경 이하만.
    const cb = b.cert || {};
    let certSum = 0;
    if (cb.현계급취득 !== false) {
      if (cb.computer && isGyeonghyoIha(rank)) {
        const c = (CERT_BONUS.computer || []).find(x => x.id === cb.computer);
        if (c) certSum += c.point;
      }
      certSum += Number(cb.jobTier) || 0;
    }
    parts.cert = Math.min(round2(certSum), CERT_BONUS.cap);

    // ② 학위 — 선택 중 가장 높은 1개. 전문학사·학사는 소방경 이하만.
    const db = b.degree || {};
    let degPt = 0;
    if (db.현계급취득 !== false) {
      (db.ids || []).forEach(id => {
        const d = (DEGREE_BONUS.items || []).find(x => x.id === id);
        if (!d) return;
        if (d.gyeonghyoOnly && !isGyeonghyoIha(rank)) return;
        if (d.point > degPt) degPt = d.point;
      });
    }

    // ③ 어학
    const lb = b.lang || {};
    let langPt = 0;
    if (lb.현계급취득 !== false) langPt = langPoint(lb.test, lb.score);

    // 학위+어학 합산 상한 0.5
    parts.degree = round2(degPt);
    parts.lang = round2(langPt);
    const degreeLang = Math.min(round2(degPt + langPt), LANG_BONUS.degreeLangCap);
    parts.degreeLang = degreeLang;

    // ④ 격무·기피부서: 6개월 초과분 × 0.05, 상한 2.0
    const hb = b.hardship || {};
    const hMonths = careerMonths(hb.start, hb.end, hb.exclude);
    const hPay = Math.max(0, hMonths - HARDSHIP_BONUS.freeMonths);
    parts.hardship = Math.min(round2(hPay * HARDSHIP_BONUS.perMonth), HARDSHIP_BONUS.cap);
    parts.hardshipMonths = hMonths;

    // ⑤ 대회·평가(우수실적) 상한 2.0, 현 계급
    const ct = b.contest || {};
    parts.contest = (ct.현계급취득 === false) ? 0 : clamp(Number(ct.value) || 0, 0, CONTEST_CAP);

    // ⑥ 인사교류 상한 3.0
    parts.exchange = clamp(Number((b.exchange || {}).value) || 0, 0, EXCHANGE_CAP);

    const sum = parts.cert + parts.degreeLang + parts.hardship + parts.contest + parts.exchange;
    return { parts, total: Math.min(round2(sum), BONUS_TOTAL), max: BONUS_TOTAL };
  }

  const avg = (arr) => {
    const nums = (arr || []).map(Number).filter(x => !isNaN(x));
    if (!nums.length) return 0;
    return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
  };

  // 교육훈련성적 원점수 합계(계급별 구성 반영)
  //  inputs: { policy, mgmt, proEdu:{...}, drillRounds:[], fitnessRounds:[], proAbility:{selectedIds,acquiredMap} }
  function eduScore(rank, inputs) {
    inputs = inputs || {};
    const comp = EDU_COMPOSITION[rank];
    const parts = {};
    let total = 0;
    if (comp.policy) { const v = clamp(Number(inputs.policy)||0, 0, comp.policy.max); parts.policy = { label:"소방정책관리자교육", value:v, max:comp.policy.max }; total += v; }
    if (comp.mgmt)   { const v = clamp(Number(inputs.mgmt)||0, 0, comp.mgmt.max); parts.mgmt = { label:"관리역량교육", value:v, max:comp.mgmt.max }; total += v; }
    if (comp.edu)    { const r = proEduScore(rank, inputs.proEdu); parts.edu = { label:"전문교육훈련", value:r.total, max:comp.edu.max, detail:r.parts }; total += r.total; }
    if (comp.drill)  { const v = clamp(avg(inputs.drillRounds), 0, comp.drill.max); parts.drill = { label:"직장훈련", value:v, max:comp.drill.max, rounds:comp.drill.rounds }; total += v; }
    if (comp.fitness){ const v = clamp(avg(inputs.fitnessRounds), 0, comp.fitness.max); parts.fitness = { label:"체력검정", value:v, max:comp.fitness.max, rounds:comp.fitness.rounds }; total += v; }
    if (comp.pro)    { const r = proAbilityScore(rank, (inputs.proAbility||{}).selectedIds, (inputs.proAbility||{}).acquiredMap); parts.pro = { label:"전문능력", value:r.total, max:comp.pro.max, detail:r.detail }; total += r.total; }
    const max = Object.values(comp).reduce((a, c) => a + c.max, 0);
    return { parts, total: round2(total), max };
  }

  // 전체 계산 → 원점수 + 명부 환산
  function calculate(rank, model) {
    const w = rankWeights(rank);
    const workRaw = clamp(Number(model.work)||0, 0, w.work.rawMax);
    const months = careerMonths(model.appointDate, model.baseDate, model.excludeMonths);
    const career = careerScore(rank, months);
    const edu = eduScore(rank, model.edu);
    const bonus = bonusScore(rank, model.bonus);

    const workBoon   = round2(workRaw * w.work.factor);
    const careerBoon = round2(career.total * w.career.factor);
    const eduBoon    = round2(edu.total * w.edu.factor);

    const boonTotal = round2(workBoon + careerBoon + eduBoon); // 명부 100점 만점
    const grandTotal = round2(boonTotal + bonus.total);        // + 가점

    return {
      rank, months,
      rows: [
        { key:"work",   label:"근무성적평정", raw:workRaw,      rawMax:w.work.rawMax,   boon:workBoon,   boonMax:w.work.boonMax },
        { key:"career", label:"경력평정",     raw:career.total, rawMax:w.career.rawMax, boon:careerBoon, boonMax:w.career.boonMax, extra:career },
        { key:"edu",    label:"교육훈련성적", raw:edu.total,    rawMax:w.edu.rawMax,    boon:eduBoon,    boonMax:w.edu.boonMax,    extra:edu },
      ],
      bonus,
      boonTotal, boonMax:100,
      grandTotal, grandMax:105,
    };
  }

  return { round2, round3, careerMonths, careerScore, proEduScore, proAbilityScore, bonusScore, eduScore, calculate };
});
