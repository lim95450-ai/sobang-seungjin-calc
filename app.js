/* app.js — UI 렌더링, 실시간 계산, 추천, Supabase 익명 로깅 */
(function () {
  "use strict";
  const $ = (s, r=document) => r.querySelector(s);
  const el = (tag, attrs={}, ...kids) => {
    const n = document.createElement(tag);
    for (const k in attrs) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach(c => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  };

  let state = {
    rank: "소방사",
    baseDate: defaultBaseDate(),
    model: {}, // per-rank inputs live here
  };

  function defaultBaseDate() {
    const now = new Date();
    const y = now.getFullYear();
    // 가까운 기준일(4/1, 10/1) 중 최근 지난 것
    const apr = `${y}-04-01`, oct = `${y}-10-01`;
    if (now >= new Date(oct)) return oct;
    if (now >= new Date(apr)) return apr;
    return `${y-1}-10-01`;
  }

  // ---------- 렌더: 상단(계급/기준일) ----------
  function renderTop() {
    const rb = $("#rankButtons");
    rb.innerHTML = "";
    RANKS.forEach(r => {
      rb.appendChild(el("button", {
        class: "rank-btn" + (r === state.rank ? " active" : ""),
        type: "button",
        onclick: () => { state.rank = r; state.model = {}; renderAll(); }
      }, r));
    });

    const by = $("#baseYear"), bh = $("#baseHalf");
    const curY = state.baseDate.slice(0,4), curHalf = state.baseDate.slice(5); // "2025", "10-01"
    by.innerHTML = "";
    const y = new Date().getFullYear();
    for (let yy = y+1; yy >= y-3; yy--) {
      const op = el("option", { value:String(yy) }, String(yy)+"년");
      if (String(yy) === curY) op.selected = true;
      by.appendChild(op);
    }
    bh.value = curHalf;
    const sync = () => { state.baseDate = `${by.value}-${bh.value}`; recompute(); };
    by.onchange = sync; bh.onchange = sync;
  }

  function initQR() {
    const img = $("#qrImg"); if (!img) return;
    const url = location.protocol.startsWith("http") ? location.origin + location.pathname : location.href;
    img.src = "https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=0&data=" + encodeURIComponent(url);
  }

  // ---------- 렌더: 동적 폼 ----------
  function m() { return state.model; }

  function numRow(label, sub, key, max, step) {
    const inp = el("input", {
      class:"num-sm", type:"number", min:"0", max:String(max), step:String(step||0.01),
      value: m()[key] != null ? m()[key] : "",
      oninput: e => { m()[key] = e.target.value === "" ? "" : Number(e.target.value); recompute(); }
    });
    return el("div", { class:"row" },
      el("div", { class:"lbl" }, label, sub ? el("small", {}, sub) : ""),
      el("div", { class:"ctrl" }, inp, el("span", { class:"unit" }, "/ " + max))
    );
  }

  function roundsRow(title, sub, key, count, max) {
    if (!m()[key]) m()[key] = new Array(count).fill("");
    if (m()[key].length !== count) m()[key] = new Array(count).fill("").map((_,i)=> (m()[key][i]!=null?m()[key][i]:""));
    const wrap = el("div", { class:"rounds" });
    for (let i=0;i<count;i++){
      wrap.appendChild(el("div", { class:"round-item" },
        el("span", {}, `${i+1}회`),
        el("input", { type:"number", min:"0", max:String(max), step:"0.01",
          value: m()[key][i] != null ? m()[key][i] : "",
          oninput: e => { m()[key][i] = e.target.value === "" ? "" : Number(e.target.value); recompute(); } })
      ));
    }
    return el("div", {},
      el("h3", {}, title, el("span", { class:"pill" }, `${count}회 평균`)),
      sub ? el("p", { class:"section-note" }, sub) : "",
      wrap
    );
  }

  function proEduBlock() {
    const pe = m().proEdu || (m().proEdu = {});
    const rows = [];
    if (state.rank === "소방사") {
      rows.push(el("label", { class:"check" + (pe.sinim?" on":"") },
        el("input", { type:"checkbox", ...(pe.sinim?{checked:"checked"}:{}),
          onchange:e=>{ pe.sinim=e.target.checked; recompute(); render(); } }),
        el("span", {}, "신임교육과정 이수 (2.5점)")));
    }
    const mk = (label, key, unit, ph) => el("div", { class:"row" },
      el("div", { class:"lbl" }, label),
      el("div", { class:"ctrl" },
        el("input", { class:"num-sm", type:"number", min:"0", step:"1", placeholder:ph||"",
          value: pe[key]!=null?pe[key]:"",
          oninput:e=>{ pe[key]= e.target.value===""?"":Number(e.target.value); recompute(); } }),
        el("span", { class:"unit" }, unit)));
    rows.push(mk("전문교육 이수시간 (시간당 0.04점)", "proHours", "시간"));
    rows.push(mk("외부위탁 직무전문교육 시간 (0.04점/h, 최대 1점)", "outsourceHours", "시간"));
    rows.push(mk("사이버교육 과정 수 (과정당 0.25점, 최대 1점)", "cyberCourses", "개"));
    return el("div", {},
      el("h3", {}, "전문교육훈련성적", el("span",{class:"pill"},"최대 3점")),
      el("p", { class:"section-note" }, "예규 제11조. 합계 3점을 넘지 않습니다."),
      ...rows
    );
  }

  function proAbilityBlock() {
    const pa = m().proAbility || (m().proAbility = { selectedIds:[], acquiredMap:{} });
    if (!pa.selectedIds) pa.selectedIds = [];
    if (!pa.acquiredMap) pa.acquiredMap = {};
    const box = el("div", {});
    box.appendChild(el("h3", {}, "전문능력성적", el("span",{class:"pill"},"최대 3점"),
      el("a", { href: REG_LINKS.edu, target:"_blank", rel:"noopener", class:"reglink" }, "예규 제12조")));

    if (state.rank === "소방사") {
      box.appendChild(el("p", { class:"section-note" }, "예규 제12조. 소방사는 취득시점과 무관하게 보유 여부로 평정합니다."));
      const list = el("div", { class:"checklist" });
      PRO_ABILITY.소방사.items.forEach(it => list.appendChild(certCheck(it, pa, false)));
      box.appendChild(list);
    } else {
      box.appendChild(el("p", { class:"section-note" }, "예규 제12조. 소방교·소방장은 현 계급에서 취득한 자격만 인정됩니다. 각 항목의 ‘현 계급 취득’을 체크하세요."));
      const cfg = PRO_ABILITY.소방교장;
      box.appendChild(el("h3", { class:"muted", style:"font-size:.82rem;margin-top:8px" }, "가목 · 각 1.5점"));
      const g1 = el("div", { class:"checklist" });
      cfg.ga.forEach(it => g1.appendChild(certCheck(it, pa, true)));
      box.appendChild(g1);
      box.appendChild(el("h3", { class:"muted", style:"font-size:.82rem;margin-top:10px" }, "나목 · 각 3점"));
      const g2 = el("div", { class:"checklist" });
      cfg.na.forEach(it => g2.appendChild(certCheck(it, pa, true)));
      box.appendChild(g2);
    }
    return box;
  }

  function certCheck(it, pa, needAcq) {
    const on = pa.selectedIds.includes(it.id);
    const badge = it.point === 3 ? "badge-3" : "badge-15";
    const box = el("label", { class:"check " + badge + (on?" on":"") },
      el("input", { type:"checkbox", ...(on?{checked:"checked"}:{}),
        onchange:e=>{
          if (e.target.checked) { if(!pa.selectedIds.includes(it.id)) pa.selectedIds.push(it.id); if(needAcq && pa.acquiredMap[it.id]==null) pa.acquiredMap[it.id]=true; }
          else { pa.selectedIds = pa.selectedIds.filter(x=>x!==it.id); }
          recompute(); render();
        } }),
      el("span", {}, it.name)
    );
    if (needAcq && on) {
      box.appendChild(el("label", { class:"acq", onclick:e=>e.stopPropagation() },
        el("input", { type:"checkbox", ...(pa.acquiredMap[it.id]!==false?{checked:"checked"}:{}),
          onchange:e=>{ pa.acquiredMap[it.id]=e.target.checked; recompute(); } }),
        el("span", {}, "현 계급 취득")));
    }
    return box;
  }

  const isGyeonghyoIha = (r) => !["소방정","소방령"].includes(r); // 소방경 이하
  const opt = (v, label, cur) => el("option", { value:String(v), ...(String(v)===String(cur)?{selected:"selected"}:{}) }, label);
  function acqRow(rec, label) {
    return el("label", { class:"acq", style:"padding-left:2px;margin:2px 0 6px" },
      el("input", { type:"checkbox", ...(rec.현계급취득!==false?{checked:"checked"}:{}),
        onchange:e=>{ rec.현계급취득=e.target.checked; recompute(); } }),
      el("span", {}, label||"현 계급에서 취득·수행"));
  }

  function bonusBlock() {
    const bm = m().bonus || (m().bonus = {});
    if (!bm.computer) bm.computer = { id:"", 현계급취득:true };
    if (!bm.job) bm.job = { tier:0, 현계급취득:true };
    if (!bm.lang) bm.lang = { category:"", test:"", score:"", grade:"", 현계급취득:true };
    if (!bm.degree) bm.degree = { ids:[], 현계급취득:true };
    if (!bm.hardship) bm.hardship = { start:"", end:"", exclude:"" };
    if (!bm.contest) bm.contest = { value:"", 현계급취득:true };
    if (!bm.exchange) bm.exchange = { value:"" };
    const gyeonghyo = isGyeonghyoIha(state.rank);

    const box = el("div", {});
    box.appendChild(el("h2", {}, "가점 ", el("span",{class:"pill"},"합계 최대 5점")));
    box.appendChild(el("p", { class:"section-note" },
      "시행규칙 제15조의2 + ",
      el("a", { href: REG_LINKS.bonusMain, target:"_blank", rel:"noopener" }, "소방공무원 가점평정 규정(PDF)"),
      "(소방청예규 제97호, 2024.9.30). 각 항목은 원칙적으로 현 계급에서 취득·수행한 경우만 인정됩니다(제2조)."));

    // ① 전산자격 (별표1) — 직무자격과 합산 상한 0.5
    box.appendChild(el("h3", {}, "① 전산자격 가점 ", el("span",{class:"pill"},"직무자격과 합산 상한 0.5점"),
      el("a", { href: REG_LINKS.bonusAnnex1, target:"_blank", rel:"noopener", class:"reglink" }, "제3조·별표1 PDF")));
    if (gyeonghyo) {
      const compSel = el("select", { class:"input", onchange:e=>{ bm.computer.id=e.target.value; recompute(); } },
        opt("", "전산 자격증 없음", bm.computer.id),
        ...CERT_BONUS.computer.map(c => opt(c.id, `${c.name} (${c.point}점)`, bm.computer.id)));
      box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"전산 자격증", el("small",{},"국가기술자격법 워드프로세서·컴퓨터활용능력, 소방경 이하만")), el("div",{class:"ctrl"}, compSel)));
      box.appendChild(acqRow(bm.computer, "전산자격 현 계급 취득"));
    } else {
      box.appendChild(el("p", { class:"section-note" }, "전산자격 가점은 소방경 이하만 대상입니다(별표1 비고)."));
    }

    // ② 직무자격 (별표2)
    box.appendChild(el("h3", {}, "② 직무자격 가점 ", el("span",{class:"pill"},"전산자격과 합산 상한 0.5점"),
      el("a", { href: REG_LINKS.bonusAnnex2, target:"_blank", rel:"noopener", class:"reglink" }, "제4조·별표2 PDF")));
    const jobSel = el("select", { class:"input", onchange:e=>{ bm.job.tier=Number(e.target.value)||0; recompute(); render(); } },
      opt(0, "직무 자격증 없음", bm.job.tier),
      ...JOB_CERT.jobTiers.map(t => opt(t.point, `${t.point}점 등급`, bm.job.tier)));
    box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"직무 자격증 등급"), el("div",{class:"ctrl"}, jobSel)));
    const curTier = JOB_CERT.jobTiers.find(t=>t.point===Number(bm.job.tier));
    if (curTier) box.appendChild(el("p", { class:"section-note", style:"margin-top:0" }, curTier.desc));
    box.appendChild(acqRow(bm.job, "직무자격 현 계급 취득"));
    box.appendChild(el("p", { class:"section-note" }, "※ 전문능력성적으로 이미 평정된 자격증은 가점으로 중복 평정할 수 없습니다(제10조①). 같은 종류는 가장 높은 것 1개만 인정."));

    // ③ 언어능력 (별표3) — 학위취득과 합산 상한 0.5
    box.appendChild(el("h3", {}, "③ 언어능력 가점 ", el("span",{class:"pill"},"학위취득과 합산 상한 0.5점"),
      el("a", { href: REG_LINKS.bonusAnnex3, target:"_blank", rel:"noopener", class:"reglink" }, "제5조·별표3 PDF")));
    const curCat = LANG_BONUS.categories.find(c => c.id === bm.lang.category);
    const catSel = el("select", { class:"input",
      onchange:e=>{ bm.lang.category=e.target.value; bm.lang.test=""; bm.lang.score=""; bm.lang.grade=""; recompute(); render(); } },
      opt("", "언어 선택 안함", bm.lang.category),
      ...LANG_BONUS.categories.map(c => opt(c.id, c.name, bm.lang.category)));
    box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"언어"), el("div",{class:"ctrl"}, catSel)));
    if (curCat) {
      const testSel = el("select", { class:"input",
        onchange:e=>{ bm.lang.test=e.target.value; bm.lang.score=""; bm.lang.grade=""; recompute(); render(); } },
        opt("", "시험 선택", bm.lang.test),
        ...curCat.tests.map(t => opt(t.id, t.name, bm.lang.test)));
      box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"시험 종류"), el("div",{class:"ctrl"}, testSel)));
      const curTest = curCat.tests.find(t => t.id === bm.lang.test);
      if (curTest && curTest.mode === "score") {
        box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"점수/등급"),
          el("div",{class:"ctrl"}, el("input", { class:"num-sm", type:"number", min:"0", placeholder:"점수",
            value: bm.lang.score!=null?bm.lang.score:"",
            oninput:e=>{ bm.lang.score= e.target.value===""?"":Number(e.target.value); recompute(); } }))));
      } else if (curTest && curTest.mode === "grade") {
        const gradeSel = el("select", { class:"input", onchange:e=>{ bm.lang.grade=e.target.value; recompute(); } },
          opt("", "등급 선택", bm.lang.grade),
          ...curTest.options.map(o => opt(o.id, `${o.label} (${o.point}점)`, bm.lang.grade)));
        box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"등급"), el("div",{class:"ctrl"}, gradeSel)));
      }
    }
    box.appendChild(acqRow(bm.lang, "언어능력 현 계급 취득"));

    // ④ 학위취득 (제6조)
    box.appendChild(el("h3", {}, "④ 학위취득 가점 ", el("span",{class:"pill"},"언어능력과 합산 상한 0.5점"),
      el("a", { href: REG_LINKS.bonusYohab, target:"_blank", rel:"noopener", class:"reglink" }, "제6조 점수표 PDF")));
    const degList = el("div", { class:"checklist" });
    DEGREE_BONUS.items.forEach(d => {
      if (d.gyeonghyoOnly && !gyeonghyo) return; // 전문학사·학사는 소방경 이하만
      const on = (bm.degree.ids||[]).includes(d.id);
      degList.appendChild(el("label", { class:"check"+(on?" on":"") },
        el("input", { type:"checkbox", ...(on?{checked:"checked"}:{}),
          onchange:e=>{ if(e.target.checked){ if(!bm.degree.ids.includes(d.id)) bm.degree.ids.push(d.id);} else { bm.degree.ids=bm.degree.ids.filter(x=>x!==d.id);} recompute(); render(); } }),
        el("span", {}, `${d.name} (${d.point}점)`)));
    });
    box.appendChild(degList);
    box.appendChild(el("p", { class:"section-note", style:"margin-top:6px" }, "같은 종류는 가장 높은 학위 1개만 인정" + (gyeonghyo?"":" (소방령·정은 석사·박사만 해당)")));
    box.appendChild(acqRow(bm.degree, "학위 현 계급 취득"));

    // ⑤ 격무·기피부서 (상한 2.0) — 날짜 자동계산
    box.appendChild(el("h3", {}, "⑤ 격무·기피부서 근무 가점 ", el("span",{class:"pill"},"상한 2.0점"),
      el("a", { href: REG_LINKS.bonusYohab, target:"_blank", rel:"noopener", class:"reglink" }, "제7조 점수표 PDF")));
    box.appendChild(el("p", { class:"section-note" }, "근무한 날부터 1개월마다 0.05점(휴직기간·30일 이상 연속 휴가기간 제외, 15일 이상 1개월 산입). 현 계급 근무분만."));
    box.appendChild(el("div", { class:"two-col" },
      el("div", {}, el("label",{class:"field-label"},"근무 시작일"),
        el("input", { class:"input", type:"date", value:bm.hardship.start||"", oninput:e=>{ bm.hardship.start=e.target.value; recompute(); } })),
      el("div", {}, el("label",{class:"field-label"},"근무 종료일(또는 기준일)"),
        el("input", { class:"input", type:"date", value:bm.hardship.end||"", oninput:e=>{ bm.hardship.end=e.target.value; recompute(); } }))));
    box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"제외기간(휴직 등, 월)"),
      el("div",{class:"ctrl"}, el("input",{ class:"num-sm", type:"number", min:"0", step:"1", placeholder:"0",
        value: bm.hardship.exclude!=null?bm.hardship.exclude:"",
        oninput:e=>{ bm.hardship.exclude= e.target.value===""?"":Number(e.target.value); recompute(); } }), el("span",{class:"unit"},"개월"))));

    // ⑥ 우수실적, ⑦ 인사교류
    box.appendChild(el("h3", {}, "⑥ 우수실적(대회·평가) 가점 ", el("span",{class:"pill"},"상한 2.0점"),
      el("a", { href: REG_LINKS.bonusAnnex5, target:"_blank", rel:"noopener", class:"reglink" }, "제8조·별표5 PDF")));
    box.appendChild(el("p", { class:"section-note" }, "전국단위 대회·평가 2.0점 이내/회, 시·도단위 0.5점 이내/회(계급당 시·도 총합 1.0 한도). 제안채택: 중앙우수제안(금상1.0·은상0.8·동상0.6·장려노력상0.5), 자체우수제안(특별상0.5·우수상0.3·우량상0.1). 소방청장·시도지사가 정한 요건에 한함(직접 입력)."));
    box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"우수실적 가점 합계", el("small",{},"상한 2.0")),
      el("div",{class:"ctrl"}, el("input",{ class:"num-sm", type:"number", min:"0", max:"2", step:"0.1",
        value: bm.contest.value!=null?bm.contest.value:"", oninput:e=>{ bm.contest.value= e.target.value===""?"":Number(e.target.value); recompute(); } }), el("span",{class:"unit"},"/ 2"))));
    box.appendChild(acqRow(bm.contest, "우수실적 현 계급"));

    box.appendChild(el("h3", {}, "⑦ 인사교류 가점 ", el("span",{class:"pill"},"상한 3.0점"),
      el("a", { href: REG_LINKS.bonusYohab, target:"_blank", rel:"noopener", class:"reglink" }, "제9조 점수표 PDF")));
    box.appendChild(el("p", { class:"section-note" }, "소방청(소속기관 포함)·중앙부처 근무(파견 포함) 후 같은 계급에서 시·도로 복귀한 경우만 해당. 근무 1개월마다 0.125점."));
    box.appendChild(el("div", { class:"row" }, el("div",{class:"lbl"},"인사교류 가점", el("small",{},"상한 3.0")),
      el("div",{class:"ctrl"}, el("input",{ class:"num-sm", type:"number", min:"0", max:"3", step:"0.1",
        value: bm.exchange.value!=null?bm.exchange.value:"", oninput:e=>{ bm.exchange.value= e.target.value===""?"":Number(e.target.value); recompute(); } }), el("span",{class:"unit"},"/ 3"))));
    return box;
  }

  function render() {
    const host = $("#dynamicForm");
    host.innerHTML = "";
    const comp = EDU_COMPOSITION[state.rank];
    const w = rankWeights(state.rank);

    // 1) 근무성적
    const c1 = el("div", { class:"card" });
    c1.appendChild(el("h2", {}, "근무성적평정 ", el("span",{class:"pill"},`원 60점 → 명부 70점`)));
    c1.appendChild(el("p", { class:"section-note" }, `예상 근무성적평정점을 입력하세요. 명부에는 ${WORK_ROUNDS[state.rank]}회 평정 평균이 반영됩니다(시행규칙 제19조).`));
    c1.appendChild(numRow("예상 근무성적평정점", "0 ~ 60점", "work", 60, 0.01));
    host.appendChild(c1);

    // 2) 경력평정
    const c2 = el("div", { class:"card" });
    c2.appendChild(el("h2", {}, "경력평정 ", el("span",{class:"pill"},`원 ${w.career.rawMax}점 → 명부 ${w.career.boonMax}점`)));
    const cc = CAREER[state.rank];
    c2.appendChild(el("p", { class:"section-note" },
      `기본경력 ${monLabel(cc.base.months)}(월 ${cc.base.perMonth}점) + 초과경력 ${monLabel(cc.over.months)}(월 ${cc.over.perMonth}점). 별표3.`));
    c2.appendChild(el("div", { class:"two-col" },
      el("div", {},
        el("label", { class:"field-label" }, "현 계급 임용일"),
        el("input", { class:"input", type:"date", value: m().appointDate||"",
          oninput:e=>{ m().appointDate=e.target.value; recompute(); } })),
      el("div", {},
        el("label", { class:"field-label" }, "경력 제외기간 (월, 선택)"),
        el("input", { class:"input", type:"number", min:"0", step:"1", placeholder:"휴직·정직 등",
          value: m().excludeMonths!=null?m().excludeMonths:"",
          oninput:e=>{ m().excludeMonths= e.target.value===""?"":Number(e.target.value); recompute(); } }))
    ));
    host.appendChild(c2);

    // 3) 교육훈련성적
    const c3 = el("div", { class:"card" });
    c3.appendChild(el("h2", {}, "교육훈련성적 ", el("span",{class:"pill"},`원 ${w.edu.rawMax}점 → 명부 ${w.edu.boonMax}점`)));
    if (comp.policy) c3.appendChild(numRow("소방정책관리자교육성적", "0 ~ 10점", "policy", 10, 0.01));
    if (comp.mgmt)   c3.appendChild(numRow("관리역량교육성적", "0 ~ 3점", "mgmt", 3, 0.01));
    if (comp.edu)    c3.appendChild(proEduBlock());
    if (comp.drill)  c3.appendChild(roundsRow("직장훈련성적", `평정 기준일 이전 회차별 평정점(0~4점). ${comp.drill.rounds}회 평균.`, "drillRounds", comp.drill.rounds, 4));
    if (comp.fitness)c3.appendChild(roundsRow("체력검정성적", `회차별 평정점(0~5점). ${comp.fitness.rounds}회 평균(체력관리 규칙).`, "fitnessRounds", comp.fitness.rounds, 5));
    if (comp.pro)    c3.appendChild(proAbilityBlock());
    host.appendChild(c3);

    // 4) 가점
    const c4 = el("div", { class:"card" });
    c4.appendChild(bonusBlock());
    host.appendChild(c4);

    // 액션
    const c5 = el("div", { class:"card" });
    c5.appendChild(el("div", { class:"actions" },
      el("button", { class:"btn primary", type:"button", onclick:saveLog }, "결과 저장"),
      el("button", { class:"btn ghost", type:"button", onclick:()=>{ state.model={}; render(); recompute(); } }, "초기화")
    ));
    host.appendChild(c5);
  }

  function monLabel(mo){ return mo%12===0 ? `${mo/12}년` : (mo>=12?`${Math.floor(mo/12)}년 ${mo%12}개월`:`${mo}개월`); }

  // ---------- 계산 & 결과 렌더 ----------
  function buildModel() {
    const mm = m();
    return {
      work: mm.work,
      appointDate: mm.appointDate, baseDate: state.baseDate, excludeMonths: mm.excludeMonths,
      edu: {
        policy: mm.policy, mgmt: mm.mgmt,
        proEdu: mm.proEdu,
        drillRounds: mm.drillRounds, fitnessRounds: mm.fitnessRounds,
        proAbility: mm.proAbility,
      },
      bonus: mm.bonus,
    };
  }

  let lastResult = null;
  function recompute() {
    const model = buildModel();
    const r = Engine.calculate(state.rank, model);
    lastResult = r;
    renderResult(r);
    renderReco(r, model);
  }

  function renderResult(r) {
    $("#grandTotal").textContent = r.grandTotal.toFixed(2);
    $("#boonTotal").textContent = r.boonTotal.toFixed(2);
    $("#bonusTotal").textContent = r.bonus.total.toFixed(2);
    const host = $("#resultRows");
    host.innerHTML = "";
    r.rows.forEach(row => {
      const pct = row.boonMax ? Math.min(100, row.boon / row.boonMax * 100) : 0;
      const node = el("div", { class:"rrow" },
        el("div", { class:"rtop" },
          el("span", { class:"rname" }, row.label),
          el("span", { class:"rscore" },
            el("span", { class:"raw" }, `${fmt(row.raw)}/${row.rawMax}`),
            el("span", { class:"arrow" }, "→"),
            el("span", { class:"boon" }, `${fmt(row.boon)}/${row.boonMax}`))),
        el("div", { class:"bar" }, el("i", { style:`width:${pct}%` }))
      );
      if (row.key === "career" && row.extra) {
        node.appendChild(el("div", { class:"rdetail" },
          `경력 ${r.months}개월 · 기본 ${fmt(row.extra.base)} + 초과 ${fmt(row.extra.over)}`));
      }
      if (row.key === "edu" && row.extra) {
        const parts = Object.values(row.extra.parts).map(p => `${p.label} ${fmt(p.value)}/${p.max}`).join(" · ");
        node.appendChild(el("div", { class:"rdetail" }, parts));
      }
      host.appendChild(node);
    });
    // 가점 행
    const bpct = Math.min(100, r.bonus.total/5*100);
    host.appendChild(el("div", { class:"rrow" },
      el("div", { class:"rtop" },
        el("span", { class:"rname" }, "가점"),
        el("span", { class:"rscore" }, el("span",{class:"boon"}, `${fmt(r.bonus.total)}/5`))),
      el("div", { class:"bar" }, el("i", { style:`width:${bpct}%` }))));
  }

  // ---------- 추천 ----------
  function renderReco(r, model) {
    const host = $("#recoBody");
    host.innerHTML = "";
    const tips = [];
    const comp = EDU_COMPOSITION[state.rank];

    // 전문능력 부족
    if (comp.pro) {
      const proRow = r.rows[2].extra.parts.pro;
      const gap = proRow.max - proRow.value;
      if (gap > 0.001) {
        if (state.rank === "소방사") {
          const pa = model.edu.proAbility || {selectedIds:[]};
          const missing = PRO_ABILITY.소방사.items.filter(it=>!(pa.selectedIds||[]).includes(it.id));
          tips.push(`전문능력 ${fmt(gap)}점 부족 — ` + missing.map(x=>`${x.name}(${x.point}점)`).join(", ") + " 취득 시 채울 수 있습니다.");
        } else {
          tips.push(`전문능력 ${fmt(gap)}점 부족 — 나목 자격증(각 3점: 소방설비기사·위험물기능장·소방시설관리사 등) 1개를 현 계급에서 취득하면 만점(3점)입니다. 가목(각 1.5점)은 2개 조합도 가능.`);
        }
      }
    }
    // 전문교육훈련 부족
    if (comp.edu) {
      const p = r.rows[2].extra.parts.edu;
      const gap = p.max - p.value;
      if (gap > 0.001) tips.push(`전문교육훈련 ${fmt(gap)}점 여유 — 직무 전문교육(시간당 0.04점)·사이버교육(과정당 0.25점, 최대 1점) 이수로 보완.`);
    }
    // 가점 부족 (여유 항목 안내)
    if (r.bonus.total < 5 - 0.001) {
      const p = r.bonus.parts;
      const room = [
        { name:"전산자격·직무자격", left: 0.5 - p.cert },
        { name:"언어능력·학위취득", left: 0.5 - p.degreeLang },
        { name:"격무·기피부서", left: 2.0 - p.hardship },
        { name:"우수실적", left: 2.0 - p.contest },
        { name:"인사교류", left: 3.0 - p.exchange },
      ].filter(x => x.left > 0.001);
      if (room.length) {
        tips.push(`가점 ${fmt(5-r.bonus.total)}점 여유 — 여유 항목: ` +
          room.map(x=>`${x.name}(+${fmt(x.left)})`).join(", ") +
          ". 자격증·어학·격무 등은 현 계급 취득·근무분만 인정됩니다.");
      }
    }
    // 근무성적 안내
    if ((Number(model.work)||0) < 60) {
      tips.push(`근무성적은 명부의 70%로 가장 비중이 큽니다(원 60점→명부 70점). 1점 차이가 명부 ${fmt(70/60)}점입니다.`);
    }

    if (!tips.length) {
      host.appendChild(el("p", { class:"reco-none" }, "주요 항목이 대부분 채워졌습니다. 👍"));
      return;
    }
    const ul = el("ul", {});
    tips.forEach(t => ul.appendChild(el("li", { html:t })));
    host.appendChild(ul);
  }

  const fmt = (x) => (Math.round(x*100)/100).toFixed(2).replace(/\.00$/,"").replace(/(\.\d)0$/,"$1");

  // ---------- Supabase 익명 저장 ----------
  let supa = null;
  function initSupa() {
    const cfg = window.SUPABASE_CONFIG || {};
    if (cfg.url && cfg.anonKey && window.supabase) {
      try { supa = window.supabase.createClient(cfg.url, cfg.anonKey); } catch(e){ supa=null; }
    }
    $("#saveNote").textContent = supa ? "‘결과 저장’ 시 익명 입력값이 통계용으로 저장됩니다(개인정보 없음)." : "";
  }
  async function saveLog() {
    if (!lastResult) return;
    if (!supa) { toast("저장 서버가 아직 설정되지 않았습니다. 계산은 정상 동작합니다."); return; }
    const cfg = window.SUPABASE_CONFIG;
    const payload = {
      rank: state.rank, base_date: state.baseDate,
      grand_total: lastResult.grandTotal, boon_total: lastResult.boonTotal, bonus_total: lastResult.bonus.total,
      inputs: buildModel(), created_at: new Date().toISOString(),
    };
    try {
      const { error } = await supa.from(cfg.table||"calc_logs").insert(payload);
      toast(error ? "저장 실패: " + error.message : "저장되었습니다.");
    } catch(e){ toast("저장 실패: " + e.message); }
  }
  function toast(msg){ const n=$("#saveNote"); n.textContent=msg; n.style.color="#111"; setTimeout(()=>{ initSupa(); n.style.color=""; },2500); }

  function renderAll(){ renderTop(); render(); recompute(); }
  document.addEventListener("DOMContentLoaded", () => { initSupa(); initQR(); renderAll(); });
})();
