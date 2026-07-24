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
    box.appendChild(el("h3", {}, "전문능력성적", el("span",{class:"pill"},"최대 3점")));

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

  function bonusBlock() {
    const bm = m().bonus || (m().bonus = {});
    const box = el("div", {});
    box.appendChild(el("h2", {}, "가점 ", el("span",{class:"pill"},"합계 최대 5점")));
    box.appendChild(el("p", { class:"section-note" }, "시행규칙 제15조의2. 대부분 항목은 현 계급에서 취득·수행한 경우만 인정됩니다. 자격증·어학 등 세부 배점은 「소방공무원 가점평정 규정」에 따릅니다."));
    BONUS.items.forEach(it => {
      const rec = bm[it.id] || (bm[it.id] = { value:"", 현계급취득:true });
      const row = el("div", { class:"row" },
        el("div", { class:"lbl" }, it.name, el("small", {}, `상한 ${it.cap}점`)),
        el("div", { class:"ctrl" },
          el("input", { class:"num-sm", type:"number", min:"0", max:String(it.cap), step:"0.1",
            value: rec.value!=null?rec.value:"",
            oninput:e=>{ rec.value= e.target.value===""?"":Number(e.target.value); recompute(); } }),
          el("span", { class:"unit" }, "/ "+it.cap))
      );
      box.appendChild(row);
      if (it.현계급요건) {
        box.appendChild(el("label", { class:"acq", style:"padding-left:2px;margin-bottom:4px" },
          el("input", { type:"checkbox", ...(rec.현계급취득!==false?{checked:"checked"}:{}),
            onchange:e=>{ rec.현계급취득=e.target.checked; recompute(); } }),
          el("span", {}, "현 계급에서 취득·수행")));
      }
    });
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
      const bm = model.bonus || {};
      const room = BONUS.items.map(it => {
        const rec = bm[it.id]||{};
        let v = Number(rec.value)||0; if (it.현계급요건 && rec.현계급취득===false) v=0;
        return { it, left: Math.max(0, it.cap - Math.min(v, it.cap)) };
      }).filter(x=>x.left>0.001);
      if (room.length) {
        tips.push(`가점 ${fmt(5-r.bonus.total)}점 여유 — 여유 항목: ` +
          room.map(x=>`${x.it.name}(+${fmt(x.left)})`).join(", ") +
          ". 자격증·어학 등은 현 계급 취득분만 인정됩니다.");
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
