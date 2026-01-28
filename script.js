
/* 모두의 성적 데이터 해석 가상 프로그램
   - GitHub Pages용 단일 페이지
   - Plotly 박스플롯 + 평균선 + 학생 위치 마커
*/

const $ = (id) => document.getElementById(id);

let SAMPLES = [];
let ACTIVE = null;
let MODE = "balanced";
let METRIC = "raw";

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function fmt1(n){ return (Math.round(n*10)/10).toFixed(1); }

function reliabilityLabel(n){
  if(n >= 300) return {label:"매우 높음", score: 0.92};
  if(n >= 200) return {label:"높음", score: 0.82};
  if(n >= 120) return {label:"보통", score: 0.70};
  return {label:"주의", score: 0.55};
}

/* ---- 가상 분포 생성(설명용)
   - 실제 개별 점수 데이터가 없으므로, 평균(mean)과 A/AB 비율을 참고해
     "설명 가능한" 형태의 분포를 만들어 박스플롯을 구성한다.
   - 목적: 정확한 석차 추정이 아니라, '해석의 논리'를 시각화
*/
function makeSyntheticScores(sample){
  const N = Math.max(80, Math.min(520, sample.students || 200));
  const mean = sample.mean;
  // A가 희소할수록 상단 꼬리(상위권)를 더 얇게
  const a = clamp((sample.a_ratio ?? 20)/100, 0.05, 0.55);
  const ab = clamp((sample.ab_ratio ?? 30)/100, 0.08, 0.75);

  // 표준편차 추정(가상): AB가 얇으면 경쟁이 촘촘 -> 분산이 상대적으로 작다고 가정
  let sd = 10.5;
  sd += (0.30 - Math.min(0.30, ab)) * 12; // AB가 작으면 sd 조금 증가(상위권만 얇아지고 양극화 느낌)
  sd -= (Math.min(0.45, a) - 0.12) * 6;  // A가 많으면 sd 감소
  sd = clamp(sd, 6.5, 14.5);

  // Boxplot이 보기 좋게 나오도록 혼합 정규 샘플링(가상)
  const scores = [];
  function randn(){
    // Box-Muller
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // 본체 88%, 상단 꼬리 12% (A 희소할수록 꼬리 비중 감소)
  const tailFrac = clamp(0.10 + (0.16 - a) * 0.25, 0.06, 0.18);
  const mainN = Math.round(N * (1 - tailFrac));
  const tailN = N - mainN;

  for(let i=0;i<mainN;i++){
    const x = mean + randn() * sd;
    scores.push(clamp(x, 0, 100));
  }
  // 꼬리: 평균 + 1.2sd 부근 중심, 분산은 작게
  for(let i=0;i<tailN;i++){
    const x = mean + (1.2*sd) + randn() * (sd*0.55);
    scores.push(clamp(x, 0, 100));
  }

  // 학생 점수가 극단적으로 밖으로 튀면 시각적으로 불편하니 조금 보정
  // (단, 실제 값은 그대로 표시)
  return scores;
}

function setTheme(next){
  const root = document.documentElement;
  if(next){
    root.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    return;
  }
  const cur = root.getAttribute("data-theme") || "dark";
  const nxt = cur === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", nxt);
  localStorage.setItem("theme", nxt);
}

function modeName(v){
  return ({
    balanced:"종합적 해석",
    achievement:"성취도 중심(보수적)",
    raw:"원점수 중심(적극적)",
    distribution:"분포 민감형(A/AB 강조)",
    reliability:"신뢰도 강화형(수강자수 강조)"
  })[v] || "종합적 해석";
}

function computeSignals(s){
  const diff = s.raw_score - s.mean;
  const a = s.a_ratio;
  const ab = s.ab_ratio;
  const n = s.students;

  const rel = reliabilityLabel(n);

  // 기본 스코어(설명용, 0~100)
  let score = 50;

  // 원점수-평균
  score += clamp(diff, -20, 25) * 1.2;

  // A/AB 분포: A가 낮을수록(희소) 같은 성취도라도 우호적 해석 여지
  score += (20 - clamp(a, 0, 40)) * 0.4;     // A 희소 보너스
  score += (25 - clamp(ab, 0, 60)) * 0.25;   // AB 얇음 보너스(상위권 경쟁)

  // 성취도: A면 +, B면 0, C면 -
  const ach = (s.achievement || "").toUpperCase();
  if(ach === "A") score += 8;
  else if(ach === "B") score += 0;
  else score -= 8;

  // 석차등급
  score += (3 - clamp(s.rank_grade, 1, 6)) * 3.5;

  // 신뢰도 가중
  score = score * (0.85 + rel.score*0.15);
  score = clamp(score, 1, 99);

  return {diff, rel, score};
}

function buildSummary(s){
  const grid = $("summaryGrid");
  grid.innerHTML = "";

  const items = [
    {k:"과목", v:s.course, s:"(예시)"},
    {k:"석차등급", v:`${s.rank_grade}등급`, s:"상대평가"},
    {k:"성취도", v:s.achievement, s:"성취평가"},
    {k:"원점수 / 평균", v:`${fmt1(s.raw_score)} / ${fmt1(s.mean)}`, s:"평균 대비 해석"},
    {k:"A비율", v:`${fmt1(s.a_ratio)}%`, s:"A 희소/풍부"},
    {k:"AB비율", v:`${fmt1(s.ab_ratio)}%`, s:"상위권 두께"},
    {k:"수강자수", v:`${s.students}명`, s:"분포 신뢰도"}
  ];

  items.forEach(it=>{
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<div class="k">${it.k}</div>
                     <div class="v">${it.v}</div>
                     <div class="s">${it.s}</div>`;
    grid.appendChild(div);
  });

  $("sampleNote").textContent = `샘플 해설: ${s.note || ""}`;
}

function buildReasons(s){
  const {diff, rel} = computeSignals(s);

  const diffMsg = diff >= 0 ? `평균 대비 +${fmt1(diff)}점` : `평균 대비 ${fmt1(diff)}점`;
  const aMsg = `A비율 ${fmt1(s.a_ratio)}%`;
  const abMsg = `AB비율 ${fmt1(s.ab_ratio)}%`;
  const nMsg = `수강자수 ${s.students}명 (신뢰도: ${rel.label})`;

  const blocks = [];

  blocks.push({
    title:"근거 1) 평균 대비 원점수",
    bullets:[
      `${diffMsg} → 단순 등급보다 “실제 성취 수준”을 보정해 해석할 수 있음`,
      `평균과의 차이가 클수록 상위 성과일 가능성이 커짐(단, 분포·수강자수와 함께 확인)`
    ]
  });

  blocks.push({
    title:"근거 2) 성취도 분포 맥락(A/AB 비율)",
    bullets:[
      `${aMsg} → A가 희소하면, B라도 상위권일 여지가 생김(‘A 컷 근처’ 가능성)`,
      `${abMsg} → 상위권 두께가 얇으면, 같은 점수 차이의 의미가 커질 수 있음`
    ]
  });

  blocks.push({
    title:"근거 3) 근거의 신뢰도(수강자수)",
    bullets:[
      `${nMsg}`,
      `수강자가 충분히 많을수록 분포 기반 해석(평균·비율)이 안정적`
    ]
  });

  // 모드별 추가 설명
  if(MODE === "achievement"){
    blocks.push({
      title:"모드 포인트) 성취도 중심(보수적)",
      bullets:[
        `성취도(A/B/C)를 더 크게 반영해, “최상위권 단정”을 자제`,
        `다만 평균 대비 차이·A/AB 맥락은 ‘보완 근거’로 활용`
      ]
    });
  } else if(MODE === "raw"){
    blocks.push({
      title:"모드 포인트) 원점수 중심(적극적)",
      bullets:[
        `평균 대비 원점수 차이를 핵심으로 보고, 성취도는 보조 근거로 사용`,
        `B라도 평균 대비 충분히 높다면 “실질 상위권”으로 해석 가능`
      ]
    });
  } else if(MODE === "distribution"){
    blocks.push({
      title:"모드 포인트) 분포 민감형",
      bullets:[
        `A/AB 비율을 강하게 반영: 같은 성취도라도 ‘희소성’에 따라 의미가 달라짐`,
        `A가 희소한 과목의 B를 상대적으로 우호적으로 해석`
      ]
    });
  } else if(MODE === "reliability"){
    blocks.push({
      title:"모드 포인트) 신뢰도 강화형",
      bullets:[
        `수강자 수가 많을수록 판단 확신도를 높이고, 적으면 ‘주의’ 표시`,
        `근거의 무게(신뢰도)를 함께 제시해 과도한 단정을 방지`
      ]
    });
  }

  const wrap = $("reasons");
  wrap.innerHTML = "";
  blocks.forEach(b=>{
    const div = document.createElement("div");
    div.className = "reason";
    div.innerHTML = `<div class="title">${b.title}</div><ul>${b.bullets.map(x=>`<li>${x}</li>`).join("")}</ul>`;
    wrap.appendChild(div);
  });

  const chip = $("reliabilityChip");
  chip.textContent = `신뢰도: ${rel.label}`;
}

function buildVerdict(s){
  const {diff, rel, score} = computeSignals(s);
  const ach = (s.achievement || "").toUpperCase();
  const diffText = diff >= 0 ? `평균 대비 원점수가 ${fmt1(diff)}점 높고` : `평균 대비 원점수가 ${fmt1(diff)}점 낮아`;
  const aText = `A비율(${fmt1(s.a_ratio)}%)`;
  const abText = `AB비율(${fmt1(s.ab_ratio)}%)`;
  const nText = `수강자수(${s.students}명)`;

  let body = "";

  if(MODE === "achievement"){
    body =
`본 학생은 석차등급 ${s.rank_grade}등급, 성취도 ${ach}로 확인됩니다.
성취도 ${ach}의 특성을 고려할 때 최상위권으로 단정하기보다는, ${diffText} ${aText}·${abText}와 같은 분포 맥락을 함께 확인할 필요가 있습니다.
특히 ${nText}로 분포 해석의 신뢰도는 ${rel.label} 수준이며, 종합적으로는 “학업성취의 안정성”을 확인할 수 있는 사례로 해석할 수 있습니다.`;
  } else if(MODE === "raw"){
    body =
`본 학생은 성취도 ${ach}이나, ${diffText} 평균 대비 성취가 뚜렷합니다.
또한 ${aText}·${abText}를 고려하면, 성취도 ${ach}임에도 “A 컷 근처” 또는 상위권 가능성을 배제하기 어렵습니다.
${nText}로 분포 기반 해석의 신뢰도는 ${rel.label}이며, 종합적으로 실질 학업역량은 상위권으로 해석할 여지가 있습니다.`;
  } else if(MODE === "distribution"){
    body =
`본 학생의 해석에서 핵심은 분포 맥락입니다. ${aText}·${abText}가 보여주는 상위권 희소성을 고려하면,
성취도 ${ach} 및 석차등급 ${s.rank_grade}등급을 “그 자체”로만 보지 않고, 동일 성취도 내 위치를 재해석할 수 있습니다.
${diffText} ${nText}를 함께 보면, 분포 맥락상 학업역량을 우호적으로 판단할 근거가 존재합니다(단, 대학·전형별 강조점은 상이할 수 있음).`;
  } else if(MODE === "reliability"){
    body =
`본 학생은 ${diffText} 분포상 상위 성과로 해석될 수 있습니다.
다만 판단의 확신도는 근거의 신뢰도에 의해 달라집니다. 본 사례의 ${nText}는 해석 신뢰도가 ${rel.label} 수준입니다.
따라서 “상대적 위치”는 긍정적 신호가 있으나, 실제 평가는 전형별 추가 자료(교과 이수 맥락, 세특 등)와 함께 종합 판단됩니다.`;
  } else {
    body =
`본 학생은 성취도 ${ach} 및 석차등급 ${s.rank_grade}등급으로 확인됩니다.
동시에 ${diffText} ${aText}·${abText} 및 ${nText}를 종합하면,
성취도 ${ach}임에도 실질 성취 수준이 상위권으로 해석될 가능성이 있습니다.
다만 본 화면은 연수용 가상 시뮬레이션이며, 실제 대학·전형별 판단 기준은 서로 다를 수 있습니다.`;
  }

  const summaryLine = `해석 신호(설명용): ${Math.round(score)} / 100 · 신뢰도: ${rel.label}`;
  $("verdictText").innerHTML = `<div style="font-weight:900; margin-bottom:8px;">${summaryLine}</div>${body.replaceAll("\n","<br/>")}`;
  $("modeBadge").textContent = modeName(MODE);
}

function buildChart(s){
  const synthetic = makeSyntheticScores(s);
  const metricTitle = (METRIC === "raw") ? "교과성적 원점수 분포(가상)" :
                      (METRIC === "diff") ? "평균 대비 차이(가상 분포 기반)" :
                      "분포 맥락(비율) 참고용";

  $("chartTitle").textContent = metricTitle;

  const mean = s.mean;
  const student = s.raw_score;

  const boxTrace = {
    type: "box",
    y: synthetic,
    name: "전체 분포(가상)",
    boxpoints: false,
    hovertemplate: "원점수: %{y:.1f}<extra></extra>",
  };

  const studentTrace = {
    type: "scatter",
    y: [student],
    x: [0],
    mode: "markers",
    name: "학생 위치",
    marker: { size: 12, symbol: "circle" },
    hovertemplate: `학생 원점수: ${student.toFixed(1)}<extra></extra>`
  };

  const layout = {
    margin: { l: 44, r: 18, t: 10, b: 36 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    showlegend: true,
    legend: { orientation: "h", x: 0, y: -0.18 },
    yaxis: {
      title: "원점수",
      range: [0, 100],
      gridcolor: "rgba(255,255,255,0.10)",
      zerolinecolor: "rgba(255,255,255,0.12)"
    },
    xaxis: {
      visible: false
    },
    shapes: [
      // mean line (horizontal across chart): use y0=y1=mean
      {
        type: "line",
        xref: "paper",
        x0: 0,
        x1: 1,
        yref: "y",
        y0: mean,
        y1: mean,
        line: { width: 3, dash: "solid" }
      }
    ],
    annotations: [
      {
        xref: "paper",
        x: 1,
        yref: "y",
        y: mean,
        text: `평균 ${mean.toFixed(1)}`,
        showarrow: false,
        xanchor: "right",
        yanchor: "bottom",
        font: { size: 12 }
      }
    ]
  };

  const config = { responsive: true, displayModeBar: false };

  Plotly.newPlot("plot", [boxTrace, studentTrace], layout, config);
}

function setMetric(next){
  METRIC = next;
  document.querySelectorAll(".pill").forEach(p=>{
    p.classList.toggle("active", p.dataset.metric === next);
  });
  rerender();
}

function rerender(){
  if(!ACTIVE) return;
  buildSummary(ACTIVE);
  buildReasons(ACTIVE);
  buildVerdict(ACTIVE);
  buildChart(ACTIVE);
}

async function init(){
  // theme
  const saved = localStorage.getItem("theme");
  if(saved) setTheme(saved);

  $("themeBtn").addEventListener("click", ()=>setTheme());

  // load samples
  const res = await fetch("./samples.json");
  SAMPLES = await res.json();

  const sel = $("studentSelect");
  sel.innerHTML = SAMPLES.map(s=>`<option value="${s.id}">${s.name} · ${s.course}</option>`).join("");
  sel.addEventListener("change", ()=>{
    ACTIVE = SAMPLES.find(x=>x.id === sel.value);
    rerender();
  });

  $("modeSelect").addEventListener("change", (e)=>{
    MODE = e.target.value;
    rerender();
  });

  document.querySelectorAll(".pill").forEach(btn=>{
    btn.addEventListener("click", ()=>setMetric(btn.dataset.metric));
  });

  // set initial
  ACTIVE = SAMPLES[0];
  sel.value = ACTIVE.id;
  rerender();
}

init().catch(err=>{
  console.error(err);
  alert("샘플 데이터를 불러오지 못했습니다. GitHub Pages에서 같은 폴더에 올렸는지 확인해주세요.");
});

function buildStackBar(s){
  const a=s.a_ratio;
  const ab=s.ab_ratio;
  const b=Math.max(0,ab-a);
  const rest=Math.max(0,100-ab);

  const data=[{
    type:"bar",
    x:["분포"],
    y:[a],
    name:"A",
  },{
    type:"bar",
    x:["분포"],
    y:[b],
    name:"B",
  },{
    type:"bar",
    x:["분포"],
    y:[rest],
    name:"기타",
  }];

  Plotly.newPlot("stackbar",data,{
    barmode:"stack",
    margin:{l:40,r:10,t:30,b:30},
    title:"상위권 두께(A/B/기타)",
    yaxis:{range:[0,100],title:"비율(%)"},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    showlegend:true
  },{displayModeBar:false,responsive:true});
}

function buildRangeBar(s){
  const diff=s.raw_score-s.mean;
  let center=50;
  if(diff>10) center=20;
  else if(diff>5) center=30;
  else if(diff>0) center=40;
  else center=55;

  const band=10;
  const low=Math.max(0,center-band);
  const high=Math.min(100,center+band);

  const data=[{
    type:"bar",
    x:[low],
    y:["위치"],
    orientation:"h",
    marker:{color:"rgba(200,200,200,0.3)"},
    hoverinfo:"skip"
  },{
    type:"bar",
    x:[high-low],
    y:["위치"],
    orientation:"h",
    marker:{color:"rgba(124,92,255,0.7)"},
    name:"추정 위치 범위"
  },{
    type:"bar",
    x:[100-high],
    y:["위치"],
    orientation:"h",
    marker:{color:"rgba(200,200,200,0.3)"},
    hoverinfo:"skip"
  }];

  Plotly.newPlot("rangebar",data,{
    barmode:"stack",
    margin:{l:40,r:10,t:30,b:30},
    title:"상대적 위치 범위(추정)",
    xaxis:{range:[0,100],title:"백분위(낮을수록 상위)"},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    showlegend:false
  },{displayModeBar:false,responsive:true});
}

const _rerender = rerender;
rerender = function(){
  _rerender();
  if(ACTIVE){
    buildStackBar(ACTIVE);
    buildRangeBar(ACTIVE);
  }
}
