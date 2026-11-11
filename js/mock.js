/* 메이트랩 · 모의고사 분석 (교직원용)
   시험 등록 → 원장 확정 → 답안 입력 → 학생 리포트(PDF·PNG)
   저장소: 학원 구글 시트 + Apps Script 웹 앱 (js/mock-config.js의 주소)
   주소가 비어 있으면 체험 모드(가짜 데이터, 저장 안 됨). */
'use strict';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
             set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
             del: k => { try { localStorage.removeItem(k); } catch (e) {} } };

const LOGO_SRC = 'img/logo/mate-logo.png';
const KO_AREAS = ['화법', '작문', '문법', '독서', '문학'];
const KO_COLORS = { '화법': '#2F7FC1', '작문': '#3AA3A3', '문법': '#8E5BB5', '독서': '#2E9E6B', '문학': '#D9822B' };
const PALETTE = ['#2F7FC1', '#2E9E6B', '#D9822B', '#8E5BB5', '#C0504D', '#3AA3A3', '#B08A00', '#7A8B99'];
const BRANCHES = ['목동관', '김포관'];
const GRADES = ['고1', '고2', '고3'];
const ORGS = ['교육청', '평가원', '수능'];

const urlDemo = /[?&]demo=1/.test(location.search);
const API_URL = urlDemo ? '' : ((window.MOCK_API_URL || '').trim() || LS.get('mock_api_url') || '');
const DEMO = !API_URL;

const S = { pw: '', who: '', role: '', exams: [], students: [], types: [], data: {}, tab: 'reg' };

/* ================= 서버 요청 ================= */
async function api(action, payload) {
  const body = Object.assign({ action, pw: S.pw, who: S.who }, payload || {});
  let res;
  if (DEMO) {
    await new Promise(r => setTimeout(r, 150));
    res = Demo.handle(JSON.parse(JSON.stringify(body)));
  } else {
    let r;
    try { r = await fetch(API_URL, { method: 'POST', body: JSON.stringify(body) }); }
    catch (e) { throw new Error('시트 서버에 연결하지 못했습니다. 인터넷 연결이나 연결 주소를 확인해 주세요.'); }
    try { res = await r.json(); }
    catch (e) { throw new Error('시트 서버 응답을 읽지 못했습니다. 웹 앱 배포 설정(액세스: 모든 사용자)을 확인해 주세요.'); }
  }
  if (!res.ok) {
    if (res.auth && S.role) { logout(); }
    throw new Error(res.error || '처리하지 못했습니다.');
  }
  return res;
}
async function busy(msg, fn) {
  $('busyMsg').textContent = msg; $('busy').hidden = false;
  try { return await fn(); } finally { $('busy').hidden = true; }
}
let toastT;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ================= 입장 ================= */
function initGate() {
  $('gWho').value = LS.get('mock_who') || '';
  $('demoNote').hidden = !DEMO;
  $('connUrl').value = LS.get('mock_api_url') || '';
  if (window.MOCK_API_URL) $('connBox').hidden = true;
  $('gPw').onkeydown = e => { if (e.key === 'Enter') login(); };
  $('gWho').onkeydown = e => { if (e.key === 'Enter') $('gPw').focus(); };
  setTimeout(() => ($('gWho').value ? $('gPw') : $('gWho')).focus(), 50);
}
async function login() {
  const who = $('gWho').value.trim(), pw = $('gPw').value.trim();
  $('gErr').textContent = '';
  if (!who) { $('gErr').textContent = '입력자 이름을 써 주세요.'; $('gWho').focus(); return; }
  if (!pw) { $('gErr').textContent = '비밀번호를 입력해 주세요.'; $('gPw').focus(); return; }
  S.pw = pw; S.who = who;
  $('gBtn').disabled = true;
  try {
    const r = await api('bootstrap');
    LS.set('mock_who', who);
    S.role = r.role; applyBoot(r);
    $('gPw').value = '';
    $('v-gate').hidden = true; $('v-app').hidden = false; $('hRight').hidden = false;
    $('demoBar').hidden = !DEMO;
    $('hWho').textContent = who;
    $('hRole').textContent = S.role === 'admin' ? '원장·확정' : '직원';
    $('hRole').className = 'role' + (S.role === 'admin' ? ' admin' : '');
    newExam();
    tab(S.role === 'admin' && pendingExams().length ? 'conf' : 'reg');
  } catch (e) {
    S.pw = ''; $('gErr').textContent = e.message;
  } finally { $('gBtn').disabled = false; }
}
function logout() {
  S.pw = ''; S.role = ''; S.data = {};
  $('v-app').hidden = true; $('hRight').hidden = true; $('v-gate').hidden = false;
  initGate();
}
function saveConn() {
  const u = $('connUrl').value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u)) { $('gErr').textContent = '주소는 https://script.google.com/macros/s/…/exec 모양이어야 합니다.'; return; }
  LS.set('mock_api_url', u); location.href = location.pathname;
}
function clearConn() { LS.del('mock_api_url'); location.href = location.pathname; }

function applyBoot(r) {
  S.exams = r.exams.sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month) || String(b.at).localeCompare(String(a.at)));
  S.students = r.students;
  S.types = r.types.sort((a, b) => a.no - b.no);
  const n = pendingExams().length;
  $('nConf').hidden = !n; $('nConf').textContent = n;
}
async function refreshBoot() { applyBoot(await api('bootstrap')); }
const pendingExams = () => S.exams.filter(e => e.status !== '확정');
const confirmedExams = () => S.exams.filter(e => e.status === '확정');
const examById = id => S.exams.find(e => e.id === id);

function tab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === t));
  ['reg', 'conf', 'ans', 'rep'].forEach(k => { $('t-' + k).hidden = k !== t; });
  if (t === 'reg') renderRegList();
  if (t === 'conf') renderConf();
  if (t === 'ans') initAns();
  if (t === 'rep') initRep();
  window.scrollTo(0, 0);
}

/* ================= 공통: 입력 정리·영역 해석 ================= */
function cleanDigits(s) {
  return String(s || '').replace(/[①②③④⑤]/g, c => '①②③④⑤'.indexOf(c) + 1).replace(/[^0-9]/g, '');
}
function parseNums(s) {
  return [...new Set(String(s || '').split(/[^0-9]+/).filter(Boolean).map(Number))].sort((a, b) => a - b);
}
/** "1-3 화법 / 4-7 작문" → {areas:[45], errors:[]} */
function parseAreas(text, n) {
  const areas = new Array(n).fill(''), errors = [];
  String(text || '').split(/[\/,\n;]+/).map(s => s.trim()).filter(Boolean).forEach(part => {
    const m = part.match(/^(\d+)\s*(?:[-~–]\s*(\d+))?\s*(?:번)?\s*[:：]?\s*(.+)$/);
    if (!m) { errors.push(`"${part}" — '1-3 화법'처럼 써 주세요.`); return; }
    const a = +m[1], b = m[2] ? +m[2] : a, name = m[3].trim();
    if (a < 1 || b > n || a > b) { errors.push(`"${part}" — 번호 범위가 1~${n} 밖입니다.`); return; }
    for (let i = a; i <= b; i++) {
      if (areas[i - 1] && areas[i - 1] !== name) errors.push(`${i}번이 두 영역(${areas[i - 1]}, ${name})에 겹칩니다.`);
      areas[i - 1] = name;
    }
  });
  return { areas, errors };
}
function areasToText(list) {
  const out = []; let s = 0;
  for (let i = 1; i <= list.length; i++) {
    if (i === list.length || list[i] !== list[s]) { out.push((s + 1 === i ? `${i}` : `${s + 1}-${i}`) + ' ' + list[s]); s = i; }
  }
  return out.join(' / ');
}
function enDefaultAreas(n) {
  const m = {}; S.types.forEach(t => { m[t.no] = t; });
  return Array.from({ length: n }, (_, i) => (m[i + 1] && m[i + 1].area) || '');
}
function areaColor(name, order) {
  if (KO_COLORS[name]) return KO_COLORS[name];
  const i = order.indexOf(name);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}
function gridHTML(items, opt) {
  opt = opt || {};
  const order = [...new Set(items.map(it => it.area).filter(Boolean))];
  const cells = items.map((it, i) => {
    const pick = opt.picks ? opt.picks[i] : null;
    const wrong = opt.picks && pick != null && it.ans && +pick !== +it.ans;
    return `<div class="qc${it.pt === 3 ? ' p3' : ''}${!it.ans ? ' miss' : ''}${wrong ? ' x' : ''}" style="--ac:${it.area ? areaColor(it.area, order) : 'var(--line)'}" title="${esc(it.area || '영역 없음')}${it.type ? ' · ' + esc(it.type) : ''}">
      <div class="no">${i + 1}</div><div class="a">${it.ans || '·'}</div><div class="pt">${it.pt ? it.pt + '점' : ''}</div></div>`;
  }).join('');
  const legend = order.map(a => `<span><i style="background:${areaColor(a, order)}"></i>${esc(a)} ${items.filter(x => x.area === a).length}</span>`).join('');
  return { cells, legend };
}
function examTitle(e) { return e.name || `${e.year}년 ${e.month}월 ${e.grade} ${e.subject}`; }
function examLi(e, cur, onclick) {
  return `<li><button aria-current="${cur === e.id}" onclick="${onclick}('${e.id}')">
    <span class="t">${esc(examTitle(e))}</span>
    <span class="s"><span class="subj ${e.subject}">${e.subject}</span><span class="pill ${e.status}">${e.status === '확정대기' ? '확정 대기' : e.status === '수정요청' ? '수정 요청' : '확정'}</span>${e.count ? `답안 ${e.count}명` : ''}${e.by ? ` · ${esc(e.by)}` : ''}</span></button></li>`;
}

/* ================= 1. 시험 등록 ================= */
const RF = {};
function newExam() {
  const now = new Date();
  Object.assign(RF, { id: null, status: '', subject: '국어', grade: '고2', year: now.getFullYear(), month: now.getMonth() + 1, org: '교육청', areaTouched: false, memo: '' });
  $('rfDate').value = now.toISOString().slice(0, 10);
  $('rfAns').value = ''; $('rfP3').value = ''; $('rfArea').value = '';
  $('rfErr').textContent = '';
  setAreaDefault();
  renderRegForm(); renderRegList();
}
function renderRegList() {
  $('regList').innerHTML = S.exams.length ? S.exams.map(e => examLi(e, RF.id, 'openExam')).join('') : '<li class="empty">아직 등록한 시험이 없습니다.</li>';
}
function chipRow(el, list, val, key, cls) {
  $(el).innerHTML = list.map(v => `<button class="chip ${cls ? cls(v) : ''}" aria-pressed="${v === val}" onclick="rfSet('${key}','${v}')">${v}</button>`).join('');
}
function rfSet(key, v) {
  RF[key] = v;
  if (key === 'subject') setAreaDefault();
  renderRegForm();
}
function setAreaDefault() {
  if (RF.areaTouched) return;
  $('rfArea').value = RF.subject === '영어' ? areasToText(enDefaultAreas(45)) : '';
}
function renderRegForm() {
  const locked = RF.status === '확정' && S.role !== 'admin';
  $('rfTitle').textContent = RF.id ? '시험 고치기' : '새 시험 등록';
  chipRow('rfSubj', ['국어', '영어'], RF.subject, 'subject', v => v === '국어' ? 'ko' : 'en');
  chipRow('rfGrade', GRADES, RF.grade, 'grade');
  chipRow('rfOrg', ORGS, RF.org, 'org');
  const y0 = new Date().getFullYear();
  $('rfYear').innerHTML = Array.from({ length: y0 - 2024 + 2 }, (_, i) => 2024 + i).map(y => `<option value="${y}"${y === RF.year ? ' selected' : ''}>${y}년</option>`).join('');
  $('rfMonth').innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}"${m === RF.month ? ' selected' : ''}>${m}월</option>`).join('');
  $('rfYear').onchange = () => { RF.year = +$('rfYear').value; renderRegForm(); };
  $('rfMonth').onchange = () => { RF.month = +$('rfMonth').value; renderRegForm(); };
  // 한 번 등록한 시험은 과목·학년·연도·월·기관을 바꾸지 않는다 (시험ID가 그 값으로 만들어짐)
  const idLock = !!RF.id;
  document.querySelectorAll('#rfSubj .chip,#rfGrade .chip,#rfOrg .chip').forEach(b => { b.disabled = idLock || locked; });
  $('rfYear').disabled = $('rfMonth').disabled = idLock || locked;
  ['rfDate', 'rfAns', 'rfP3', 'rfArea'].forEach(k => { $(k).disabled = locked; });
  $('rfSave').hidden = locked;
  $('rfDel').hidden = !(RF.id && S.role === 'admin');
  const gnum = +RF.grade.slice(1);
  let note = '';
  if (RF.subject === '국어' && RF.year - gnum + 1 < 2025) note = '⚠ 국어는 22개정 이후 시험(2025 고1, 2026 고2, 2027 고3부터)만 다루기로 했습니다. ';
  $('rfName').textContent = `${RF.year}년 ${RF.month}월 ${RF.grade} ${RF.subject} (${RF.org})`;
  $('rfMemo').hidden = !(RF.status === '수정요청' && RF.memo);
  $('rfMemo').textContent = '원장 수정 요청: ' + (RF.memo || '');
  const ln = $('rfLockNote');
  if (locked) { ln.hidden = false; ln.textContent = '확정된 시험입니다. 고치려면 원장(확정 비밀번호)으로 들어와야 합니다.'; }
  else if (RF.status === '확정') { ln.hidden = false; ln.textContent = '확정된 시험입니다. 고쳐서 저장하면 이미 입력한 학생 점수가 모두 새 정답으로 다시 계산됩니다.'; }
  else { ln.hidden = !note; ln.textContent = note; }
  $('rfAreaHelp').textContent = RF.subject === '국어'
    ? `— 시험지 지문 묶음대로. 쓸 수 있는 영역: ${KO_AREAS.join(' · ')}`
    : '— 유형표 기본값이 들어 있습니다. 배치가 다른 시험만 고치세요.';
  $('rfArea').placeholder = RF.subject === '국어' ? '예) 1-3 화법 / 4-7 작문 / 8-10 화법 / 11-15 문법 / 16-32 독서 / 33-45 문학' : '';
  rfLive();
}
function rfCollect() {
  const n = 45;
  const ans = cleanDigits($('rfAns').value);
  const p3 = parseNums($('rfP3').value);
  const pa = parseAreas($('rfArea').value, n);
  const defs = {}; S.types.forEach(t => { defs[t.no] = t; });
  const items = Array.from({ length: n }, (_, i) => {
    const area = pa.areas[i];
    const d = defs[i + 1];
    return { no: i + 1, ans: +ans[i] || 0, pt: p3.includes(i + 1) ? 3 : 2, area,
      type: RF.subject === '영어' && d && d.area === area ? d.type : '' };
  });
  const errs = [];
  if (ans.length !== n) errs.push(`정답이 ${ans.length}개입니다. ${n}개를 넣어 주세요.`);
  else if (/[06-9]/.test(ans)) errs.push('정답에 1~5가 아닌 숫자가 있습니다.');
  const badP = p3.filter(x => x < 1 || x > n);
  if (badP.length) errs.push(`3점 문항 번호 ${badP.join(', ')}는 범위 밖입니다.`);
  const total = items.reduce((s, it) => s + it.pt, 0);
  if (total !== 100) errs.push(`총점이 ${total}점입니다. 3점 문항을 확인해 주세요(보통 10개 → 100점).`);
  errs.push(...pa.errors);
  const emptyA = items.filter(it => !it.area).map(it => it.no);
  if (emptyA.length) errs.push(`영역이 없는 문항: ${compactNums(emptyA)}`);
  if (RF.subject === '국어') {
    const bad = [...new Set(items.map(it => it.area).filter(a => a && !KO_AREAS.includes(a)))];
    if (bad.length) errs.push(`국어 영역은 ${KO_AREAS.join('·')} 중에서만 씁니다: "${bad.join('", "')}"`);
  }
  return { items, ans, p3, total, errs, pa };
}
function compactNums(arr) {
  const out = []; let s = arr[0], p = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    if (arr[i] === p + 1) { p = arr[i]; continue; }
    out.push(s === p ? `${s}` : `${s}~${p}`); s = p = arr[i];
  }
  return out.join(', ');
}
function rfLive() {
  const c = rfCollect();
  const ac = $('rfAnsCnt');
  ac.textContent = `${c.ans.length} / 45개` + (c.ans.length ? ` · ${c.ans.replace(/(\d{5})(?=\d)/g, '$1 ')}` : '');
  ac.className = 'counter ' + (c.ans.length === 45 && !/[06-9]/.test(c.ans) ? 'good' : c.ans.length ? 'bad' : '');
  const pc = $('rfPtCnt');
  pc.textContent = `3점 ${c.p3.length}개 · 2점 ${45 - c.p3.length}개 · 총점 ${c.total}점`;
  pc.className = 'counter ' + (c.total === 100 ? 'good' : 'bad');
  const filled = c.items.filter(i => i.area).length;
  const acn = $('rfAreaCnt');
  acn.textContent = c.pa.errors.length ? c.pa.errors[0] : `영역 지정 ${filled} / 45문항`;
  acn.className = 'counter ' + (c.pa.errors.length || filled < 45 ? (filled || c.pa.errors.length ? 'bad' : '') : 'good');
  const g = gridHTML(c.items);
  $('rfGrid').innerHTML = g.cells; $('rfLegend').innerHTML = g.legend;
}
['rfAns', 'rfP3'].forEach(id => document.addEventListener('input', e => { if (e.target.id === id) rfLive(); }));
document.addEventListener('input', e => { if (e.target.id === 'rfArea') { RF.areaTouched = true; rfLive(); } });

async function openExam(id) {
  try {
    const d = await busy('불러오는 중…', () => loadExam(id, true));
    const e = d.exam;
    Object.assign(RF, { id: e.id, status: e.status, subject: e.subject, grade: e.grade, year: e.year, month: e.month, org: e.org, areaTouched: true, memo: e.memo });
    $('rfDate').value = e.date || '';
    $('rfAns').value = d.items.map(i => i.ans).join('').replace(/(\d{5})(?=\d)/g, '$1 ');
    $('rfP3').value = d.items.filter(i => i.pt === 3).map(i => i.no).join(', ');
    $('rfArea').value = areasToText(d.items.map(i => i.area));
    $('rfErr').textContent = '';
    renderRegForm(); renderRegList();
    $('regForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { toast(err.message); }
}
async function saveExam() {
  const c = rfCollect();
  $('rfErr').textContent = c.errs.join(' / ');
  if (c.errs.length) return;
  const exam = { id: RF.id, subject: RF.subject, grade: RF.grade, year: RF.year, month: RF.month, org: RF.org, date: $('rfDate').value, n: 45 };
  try {
    const r = await busy('시트에 저장하는 중…', () => api('saveExam', { exam, items: c.items }));
    delete S.data[r.id];
    await refreshBoot();
    toast(r.status === '확정' ? '저장했습니다 (확정 유지).' : '저장했습니다. 원장 확정을 기다립니다.');
    RF.areaTouched = false;
    newExam();
  } catch (e) { $('rfErr').textContent = e.message; }
}
async function deleteExam() {
  if (!RF.id) return;
  if (!confirm(`「${$('rfName').textContent}」 시험을 지울까요? 되돌릴 수 없습니다.`)) return;
  try {
    await busy('지우는 중…', () => api('deleteExam', { id: RF.id }));
    delete S.data[RF.id];
    await refreshBoot(); toast('시험을 지웠습니다.'); RF.areaTouched = false; newExam();
  } catch (e) { $('rfErr').textContent = e.message; }
}

/* ================= 2. 원장 확정 ================= */
let confCur = null;
function renderConf() {
  const p = pendingExams(), d = confirmedExams();
  $('confList').innerHTML = p.length ? p.map(e => examLi(e, confCur, 'openConf')).join('') : '<li class="empty">확정을 기다리는 시험이 없습니다.</li>';
  $('confDone').innerHTML = d.length ? d.map(e => examLi(e, confCur, 'openConf')).join('') : '<li class="empty">없음</li>';
  if (confCur && !examById(confCur)) confCur = null;
  if (!confCur) $('confView').innerHTML = '<div class="empty">왼쪽에서 시험을 고르세요.</div>';
}
async function openConf(id) {
  confCur = id; renderConf();
  try {
    const d = await busy('불러오는 중…', () => loadExam(id, true));
    const e = d.exam, admin = S.role === 'admin';
    const g = gridHTML(d.items);
    const order = [...new Set(d.items.map(i => i.area))];
    const rows = order.map(a => { const its = d.items.filter(i => i.area === a); return `<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${areaColor(a, order)};margin-right:6px"></i>${esc(a)}</td><td>${compactNums(its.map(i => i.no))}</td><td class="num">${its.length}</td><td class="num">${its.reduce((s, i) => s + i.pt, 0)}점</td></tr>`; }).join('');
    const total = d.items.reduce((s, i) => s + i.pt, 0);
    let actions = '';
    if (!admin) actions = '<p class="hint">확정·수정 요청은 원장(확정 비밀번호)으로 들어와야 할 수 있습니다.</p>';
    else if (e.status !== '확정') actions = `<div class="row"><button class="btn" onclick="confirmExam('${e.id}')">정답표 확정</button><button class="btn ghost" onclick="$('fixBox').hidden=false;$('fixMemo').focus()">수정 요청</button></div>
      <div id="fixBox" hidden style="margin-top:10px"><textarea id="fixMemo" rows="2" placeholder="예) 17번 정답 확인 바람, 3점 문항 하나 빠짐"></textarea><div class="row" style="margin-top:8px"><button class="btn small" onclick="requestFix('${e.id}')">요청 보내기</button></div></div>`;
    else actions = `<p class="hint">확정: ${esc(e.confirmedBy || '')} · ${esc(e.confirmedAt || '')} · 답안 ${e.count || d.responses.length}명</p><div class="row"><button class="btn plain" onclick="unconfirmExam('${e.id}')">확정 해제</button></div><p class="hint">정답을 고치려면 1번 탭에서 이 시험을 눌러 고치세요(원장은 확정된 채로 고칠 수 있음). 고치면 학생 점수가 자동으로 다시 계산됩니다.</p>`;
    $('confView').innerHTML = `
      <p class="eyebrow">${e.subject} · ${e.status === '확정' ? '확정됨' : '검수'}</p>
      <h2>${esc(examTitle(e))}</h2>
      <p class="hint">등록: ${esc(e.by || '')} · ${esc(e.at || '')}${e.date ? ` · 학원 응시일 ${esc(e.date)}` : ''}</p>
      ${e.status === '수정요청' && e.memo ? `<div class="memo">보낸 수정 요청: ${esc(e.memo)}</div>` : ''}
      <span class="field">정답표 — 칸 위 색 = 영역, 주황 3 = 3점</span>
      <div class="qgrid">${g.cells}</div><div class="legend">${g.legend}</div>
      <div class="scroll" style="margin-top:14px"><table class="tbl"><tr><th>영역</th><th>문항</th><th class="num">문항 수</th><th class="num">배점</th></tr>${rows}
      <tr><td><b>합계</b></td><td></td><td class="num"><b>${d.items.length}</b></td><td class="num"><b style="color:${total === 100 ? 'var(--ok)' : 'var(--warn)'}">${total}점</b></td></tr></table></div>
      <p class="hint" style="margin:12px 0">정답 하나가 틀리면 그 시험을 본 학생 전원의 채점이 틀어집니다. 시험지 정답표와 한 번 맞춰 본 뒤 확정해 주세요.</p>
      ${actions}<p class="err" id="confErr"></p>`;
  } catch (err) { toast(err.message); }
}
async function confirmExam(id) {
  try { await busy('확정하는 중…', () => api('confirmExam', { id })); delete S.data[id]; await refreshBoot(); toast('확정했습니다. 이제 답안을 입력할 수 있습니다.'); confCur = null; renderConf(); }
  catch (e) { $('confErr').textContent = e.message; }
}
async function requestFix(id) {
  const memo = $('fixMemo').value.trim();
  if (!memo) { $('confErr').textContent = '무엇을 고칠지 한 줄 적어 주세요.'; return; }
  try { await busy('보내는 중…', () => api('requestFix', { id, memo })); delete S.data[id]; await refreshBoot(); toast('수정 요청을 보냈습니다. 1번 탭 목록에 표시됩니다.'); confCur = null; renderConf(); }
  catch (e) { $('confErr').textContent = e.message; }
}
async function unconfirmExam(id) {
  if (!confirm('확정을 해제하면 이 시험은 답안 입력·리포트 목록에서 빠집니다. 해제할까요?')) return;
  try { await busy('해제하는 중…', () => api('unconfirmExam', { id })); delete S.data[id]; await refreshBoot(); toast('확정을 해제했습니다.'); confCur = null; renderConf(); }
  catch (e) { $('confErr').textContent = e.message; }
}

async function loadExam(id, force) {
  if (!force && S.data[id]) return S.data[id];
  const d = await api('getExam', { id });
  S.data[id] = d;
  return d;
}

/* ================= 3. 답안 입력 ================= */
const A = { exam: null, stu: null, q: '', newMode: false, hi: 0 };
function examOptions(sel, cur) {
  const list = confirmedExams();
  $(sel).innerHTML = list.length
    ? '<option value="">시험을 고르세요</option>' + list.map(e => `<option value="${e.id}"${e.id === cur ? ' selected' : ''}>[${e.subject}] ${esc(examTitle(e))}${e.count ? ` · ${e.count}명` : ''}</option>`).join('')
    : '<option value="">확정된 시험이 없습니다 (2번 탭에서 확정)</option>';
}
function initAns() {
  examOptions('aExam', A.exam);
  if (A.exam && examById(A.exam) && examById(A.exam).status === '확정') pickAnsExam(true); else { A.exam = null; $('aBody').hidden = true; }
}
async function pickAnsExam(keep) {
  A.exam = $('aExam').value || null;
  $('aBody').hidden = !A.exam;
  if (!A.exam) return;
  try {
    await busy('불러오는 중…', () => loadExam(A.exam, !keep));
    if (!keep) resetAnsForm(); else { renderStuPicker(); ansLive(); }
    renderAnsTable();
  } catch (e) { toast(e.message); }
}
function resetAnsForm() {
  A.stu = null; A.q = ''; A.newMode = false;
  $('aCls').value = ''; $('aAns').value = ''; $('aAbsent').checked = false; $('aErr').textContent = '';
  $('aFormTitle').textContent = '학생 답안 입력';
  renderStuPicker(); ansLive();
  setTimeout(() => { const i = $('aQ'); if (i) i.focus(); }, 30);
}
function entered() { const d = S.data[A.exam]; return d ? d.responses : []; }
function renderStuPicker() {
  const box = $('aStu');
  if (A.stu) {
    const s = A.stu, done = entered().some(r => r.sid === s.id);
    box.innerHTML = `<div class="chosen"><span><b>${esc(s.name)}</b> <span class="hint">${esc([s.grade, s.cls, s.branch].filter(Boolean).join(' · '))}${done ? ' · 이미 입력됨(고쳐서 저장)' : ''}</span></span><button class="btn plain small" onclick="A.stu=null;A.q='';renderStuPicker();setTimeout(()=>$('aQ').focus(),20)">바꾸기</button></div>`;
    return;
  }
  if (A.newMode) {
    const e = examById(A.exam) || {};
    const same = S.students.filter(s => s.name === A.q.trim());
    box.innerHTML = `<div class="newstu">
      <h3>새 학생 등록</h3>
      ${same.length ? `<p class="memo">같은 이름이 이미 있습니다: ${same.map(s => esc([s.name, s.grade, s.cls, s.branch].filter(Boolean).join(' '))).join(', ')} — 동명이인일 때만 새로 등록하세요.</p>` : ''}
      <div class="g2"><div><span class="field" style="margin-top:0">이름</span><input id="nsName" value="${esc(A.q.trim())}" autocomplete="off"></div>
      <div><span class="field" style="margin-top:0">반 <small>(기본 반)</small></span><input id="nsCls" autocomplete="off" placeholder="예) 고2 국어 A반"></div></div>
      <span class="field">학년</span><div class="chips" id="nsGrade">${GRADES.map(g => `<button class="chip" aria-pressed="${g === (e.grade || '고2')}" onclick="pressOne(this)">${g}</button>`).join('')}</div>
      <span class="field">지점</span><div class="chips" id="nsBranch">${BRANCHES.map((b, i) => `<button class="chip" aria-pressed="${i === 0}" onclick="pressOne(this)">${b}</button>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn" onclick="addStudent()">등록하고 고르기</button><button class="btn plain" onclick="A.newMode=false;renderStuPicker()">취소</button></div></div>`;
    setTimeout(() => $('nsCls').focus(), 20);
    return;
  }
  box.innerHTML = `<div class="picker"><input id="aQ" autocomplete="off" placeholder="이름을 쓰면 목록이 나옵니다" value="${esc(A.q)}"><div class="plist" id="aPl" hidden></div></div>`;
  const q = $('aQ');
  q.oninput = () => { A.q = q.value; A.hi = 0; renderMatches(); };
  q.onfocus = renderMatches;
  q.onkeydown = ev => {
    const btns = [...document.querySelectorAll('#aPl button')];
    if (ev.key === 'ArrowDown') { A.hi = Math.min(A.hi + 1, btns.length - 1); renderMatches(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { A.hi = Math.max(A.hi - 1, 0); renderMatches(); ev.preventDefault(); }
    else if (ev.key === 'Enter') { const b = btns[A.hi]; if (b) b.click(); ev.preventDefault(); }
  };
  q.onblur = () => setTimeout(() => { const p = $('aPl'); if (p) p.hidden = true; }, 180);
}
function renderMatches() {
  const pl = $('aPl'); if (!pl) return;
  const q = A.q.trim();
  if (!q) { pl.hidden = true; return; }
  const done = new Set(entered().map(r => r.sid));
  const m = S.students.filter(s => s.name.includes(q)).sort((a, b) => (a.name === q ? -1 : 0) - (b.name === q ? -1 : 0) || a.name.localeCompare(b.name)).slice(0, 12);
  pl.innerHTML = m.map((s, i) => `<button class="${i === A.hi ? 'on' : ''}" onmousedown="event.preventDefault()" onclick="chooseStu('${s.id}')"><span>${esc(s.name)}${done.has(s.id) ? ' <small>· 입력됨</small>' : ''}</span><small>${esc([s.grade, s.cls, s.branch].filter(Boolean).join(' · '))}</small></button>`).join('')
    + `<button class="${m.length === A.hi ? 'on' : ''}" onmousedown="event.preventDefault()" onclick="A.newMode=true;renderStuPicker()"><span>+ "${esc(q)}" 새 학생으로 등록</span><small>처음 보는 학생</small></button>`;
  pl.hidden = false;
}
function pressOne(btn) { btn.parentElement.querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b === btn)); }
function pressed(id) { const b = document.querySelector(`#${id} .chip[aria-pressed="true"]`); return b ? b.textContent : ''; }
function chooseStu(id) {
  const s = S.students.find(x => x.id === id); if (!s) return;
  A.stu = s; A.newMode = false;
  const r = entered().find(x => x.sid === id);
  $('aCls').value = r ? r.cls : (s.cls || '');
  $('aAns').value = r ? r.answers.replace(/(\d{5})(?=\d)/g, '$1 ') : '';
  $('aAbsent').checked = r ? r.absent : false;
  $('aFormTitle').textContent = r ? `${s.name} 답안 고치기` : '학생 답안 입력';
  renderStuPicker(); ansLive();
  setTimeout(() => ($('aCls').value ? $('aAns') : $('aCls')).focus(), 20);
}
async function addStudent() {
  const name = $('nsName').value.trim();
  if (!name) { $('aErr').textContent = '이름을 써 주세요.'; return; }
  const student = { name, cls: $('nsCls').value.trim(), grade: pressed('nsGrade'), branch: pressed('nsBranch') };
  try {
    const r = await busy('학생 등록 중…', () => api('addStudent', { student }));
    S.students.push(r.student);
    chooseStu(r.student.id);
    toast(`${name} 학생을 등록했습니다.`);
  } catch (e) { $('aErr').textContent = e.message; }
}
function ansLive() {
  const d = S.data[A.exam]; if (!d) return;
  const n = d.items.length, a = cleanDigits($('aAns').value), absent = $('aAbsent').checked;
  $('aAns').disabled = absent;
  const c = $('aAnsCnt');
  if (absent) { c.textContent = '결시로 저장합니다.'; c.className = 'counter'; return; }
  let t = `${a.length} / ${n}개`;
  if (a.length) t += ' · ' + a.replace(/(\d{5})(?=\d)/g, '$1 ');
  if (a.length === n && !/[6-9]/.test(a)) {
    const sc = scoreOf(d.items, a);
    t = `${n} / ${n}개 · 예상 ${sc.score}점 (맞힌 ${sc.correct}문항)` + (a.includes('0') ? ` · 무응답 ${a.split('0').length - 1}개` : '');
  }
  c.textContent = t;
  c.className = 'counter ' + (a.length === n && !/[6-9]/.test(a) ? 'good' : a.length ? 'bad' : '');
}
document.addEventListener('input', e => { if (e.target.id === 'aAns') ansLive(); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.target.id === 'aAns' || e.target.id === 'aCls')) { e.preventDefault(); if (e.target.id === 'aCls') $('aAns').focus(); else saveAnswer(); } });
async function saveAnswer() {
  const d = S.data[A.exam]; if (!d) return;
  $('aErr').textContent = '';
  if (!A.stu) { $('aErr').textContent = '학생을 먼저 고르세요.'; return; }
  const absent = $('aAbsent').checked, a = cleanDigits($('aAns').value), n = d.items.length;
  if (!absent && (a.length !== n || /[6-9]/.test(a))) { $('aErr').textContent = `학생이 고른 번호는 0~5 숫자 ${n}개여야 합니다. (지금 ${a.length}개)`; return; }
  const name = A.stu.name;
  try {
    const r = await busy('저장 중…', () => api('saveResponse', { examId: A.exam, studentId: A.stu.id, cls: $('aCls').value.trim(), answers: absent ? '' : a, absent }));
    const s = S.students.find(x => x.id === A.stu.id); if (s && $('aCls').value.trim()) s.cls = $('aCls').value.trim();
    await loadExam(A.exam, true);
    const ex = examById(A.exam); if (ex) ex.count = S.data[A.exam].responses.length;
    toast(absent ? `${name} 결시로 저장` : `${name} 저장 — ${scoreOf(d.items, a).score}점${r.updated ? ' (고침)' : ''}`);
    resetAnsForm(); renderAnsTable();
  } catch (e) { $('aErr').textContent = e.message; }
}
function renderAnsTable() {
  const d = S.data[A.exam]; if (!d) return;
  const rs = d.responses.slice().sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.name.localeCompare(b.name));
  $('aCount').textContent = `${rs.length}명`;
  $('aTable').innerHTML = rs.length ? `<tr><th>이름</th><th>반</th><th class="num">점수</th><th>입력</th><th></th></tr>` + rs.map(r => `<tr>
    <td><b>${esc(r.name)}</b></td><td>${esc(r.cls)}</td><td class="num">${r.absent ? '결시' : scoreOf(d.items, r.answers).score}</td>
    <td class="hint" style="font-size:12px">${esc(r.by)}</td>
    <td style="white-space:nowrap"><button class="btn plain small" onclick="chooseStu('${r.sid}');window.scrollTo({top:0,behavior:'smooth'})">고치기</button> <button class="btn plain small" onclick="delAnswer('${r.sid}')">지우기</button></td></tr>`).join('')
    : '<tr><td class="empty">아직 입력한 학생이 없습니다.</td></tr>';
}
async function delAnswer(sid) {
  const r = entered().find(x => x.sid === sid); if (!r) return;
  if (!confirm(`${r.name} 학생의 답안을 지울까요?`)) return;
  try {
    await busy('지우는 중…', () => api('deleteResponse', { examId: A.exam, studentId: sid }));
    await loadExam(A.exam, true);
    const ex = examById(A.exam); if (ex) ex.count = S.data[A.exam].responses.length;
    renderAnsTable(); toast('지웠습니다.');
  } catch (e) { toast(e.message); }
}

/* ================= 채점·분석 ================= */
function scoreOf(items, answers) {
  let score = 0, correct = 0;
  const area = {};
  items.forEach((it, i) => {
    const ok = +answers[i] === +it.ans;
    if (!area[it.area]) area[it.area] = { n: 0, c: 0, pt: 0, got: 0 };
    area[it.area].n++; area[it.area].pt += it.pt;
    if (ok) { score += it.pt; correct++; area[it.area].c++; area[it.area].got += it.pt; }
  });
  return { score, correct, area };
}
function enGrade(score) { return score >= 90 ? 1 : score >= 20 ? 10 - Math.floor(score / 10) : 9; }
function analyze(d, r) {
  const items = d.items;
  const takers = d.responses.filter(x => !x.absent && x.answers.length === items.length);
  const sameCls = r.cls ? takers.filter(x => x.cls === r.cls) : [];
  const useCls = sameCls.length >= 3;
  const group = useCls ? sameCls : takers;
  const avg = list => list.length ? list.reduce((s, x) => s + scoreOf(items, x.answers).score, 0) / list.length : null;
  const areas = [...new Set(items.map(i => i.area))];
  const me = r.absent ? null : scoreOf(items, r.answers);
  const gArea = {};
  areas.forEach(a => {
    const idx = items.map((it, i) => it.area === a ? i : -1).filter(i => i >= 0);
    let c = 0; group.forEach(x => idx.forEach(i => { if (+x.answers[i] === +items[i].ans) c++; }));
    gArea[a] = group.length ? c / (idx.length * group.length) : null;
  });
  const rate = items.map((it, i) => group.length ? group.filter(x => +x.answers[i] === +it.ans).length / group.length : null);
  return { me, areas, gArea, rate, groupLabel: useCls ? '반' : '응시자', groupN: group.length,
    clsAvg: useCls ? avg(sameCls) : null, clsN: sameCls.length, allAvg: avg(takers), allN: takers.length };
}

/* ================= 리포트 ================= */
function reportHTML(d, r, comment) {
  const e = d.exam, items = d.items, A2 = analyze(d, r), en = e.subject === '영어';
  const fmt = v => v == null ? '—' : (Math.round(v * 10) / 10).toString();
  const pct = v => v == null ? '—' : Math.round(v * 100) + '%';
  const head = `<div class="rp-head"><div class="rp-brand"><img src="${LOGO_SRC}" alt="">메이트 학원 - ${e.subject}<span class="sj">${e.subject} 모의고사 분석</span></div>
    <div class="rp-meta">${e.date ? '학원 응시일 ' + esc(e.date) + '<br>' : ''}${esc(r.branch || '')}</div></div>
    <div class="rp-title"><div><div class="ex">${esc(examTitle(e))}</div><div class="sn">${esc(r.name)}<small>${esc([r.cls && String(r.cls).startsWith(r.grade) ? '' : r.grade, r.cls].filter(Boolean).join(' · '))}</small></div></div></div>`;
  const foot = `<div class="rp-foot"><span>메이트학원 · 메이트랩 모의고사 분석</span><span>${esc(e.id)}</span></div>`;
  if (r.absent) return `<div class="rp ${en ? 'en' : ''}">${head}<div class="rp-absent">결시 — 이번 시험에 응시하지 않았습니다.</div>${foot}</div>`;
  const me = A2.me;
  const box2 = en
    ? `<div><div class="l">등급</div><div class="v">${enGrade(me.score)}<small>등급</small></div><div class="s">절대평가 (90점↑ 1등급)</div></div>`
    : `<div><div class="l">맞힌 문항</div><div class="v">${me.correct}<small>/ ${items.length}</small></div><div class="s">틀린 문항 ${items.length - me.correct}개</div></div>`;
  const kpi = `<div class="rp-kpi">
    <div class="main"><div class="l">원점수</div><div class="v">${me.score}<small>/ 100</small></div><div class="s">${en ? `맞힌 문항 ${me.correct} / ${items.length}` : `3점 문항 ${items.filter((it, i) => it.pt === 3 && +r.answers[i] === +it.ans).length} / ${items.filter(it => it.pt === 3).length} 맞힘`}</div></div>
    ${box2}
    <div><div class="l">반 평균</div><div class="v">${A2.clsAvg == null ? '—' : fmt(A2.clsAvg)}<small>${A2.clsAvg == null ? '' : '점'}</small></div><div class="s">${A2.clsAvg == null ? '반 응시 3명 이상부터' : `${esc(r.cls)} ${A2.clsN}명`}</div></div>
    <div><div class="l">학원 평균</div><div class="v">${fmt(A2.allAvg)}<small>점</small></div><div class="s">메이트학원 응시 ${A2.allN}명</div></div></div>`;
  // 영역별
  const mine = A2.areas.map(a => ({ a, v: me.area[a].c / me.area[a].n, c: me.area[a].c, n: me.area[a].n, g: A2.gArea[a] }));
  let weak = null;
  mine.forEach(x => { if (x.v < 1 && (!weak || x.v < weak.v || (x.v === weak.v && (x.g || 0) - x.v > (weak.g || 0) - weak.v))) weak = x; });
  const areaRows = mine.map(x => `<div class="rp-area${weak && weak.a === x.a ? ' isweak' : ''}"><div class="an">${esc(x.a)}${weak && weak.a === x.a ? '<span class="weak">보완</span>' : ''}</div>
    <div class="bars"><div class="me" style="width:${Math.max(x.v * 100, 0.8)}%"></div>${x.g == null ? '' : `<div class="av" style="left:${x.g * 100}%"></div>`}</div>
    <div class="pc"><b>${pct(x.v)}</b> ${x.c}/${x.n} · ${A2.groupLabel} ${pct(x.g)}</div></div>`).join('');
  // 문항별 (15줄 × 3칸)
  const per = Math.ceil(items.length / 3);
  const short = a => String(a || '').replace(' 추론', '').replace(' 파악', '').replace(' 정보', '');
  const tables = [0, 1, 2].map(k => {
    const rows = items.slice(k * per, (k + 1) * per).map((it, j) => {
      const i = k * per + j, pick = +r.answers[i], ok = pick === +it.ans, rt = A2.rate[i];
      const hot = !ok && rt != null && rt >= 0.7;
      return `<tr class="${ok ? '' : 'x'}${hot ? ' hot' : ''}"><td class="no">${it.no}${hot ? '<sup>!</sup>' : ''}</td><td class="ar">${esc(short(it.area))}</td><td>${it.ans}</td><td class="pick">${pick || '-'}</td><td class="ox">${ok ? 'O' : 'X'}</td><td class="rate">${rt == null ? '' : Math.round(rt * 100)}</td></tr>`;
    }).join('');
    return `<table><tr><th>번호</th><th>영역</th><th>정답</th><th>선택</th><th>O/X</th><th>${A2.groupLabel}%</th></tr>${rows}</table>`;
  }).join('');
  const hotN = items.filter((it, i) => +r.answers[i] !== +it.ans && A2.rate[i] != null && A2.rate[i] >= 0.7).length;
  const cmt = String(comment || '').trim();
  return `<div class="rp ${en ? 'en' : ''}">${head}${kpi}
    <div class="rp-sec"><h4>영역별 정답률 <span>막대 = 학생, 검은 선 = ${A2.groupLabel} 평균</span></h4><div class="rp-areas">${areaRows}</div>
      <div class="rp-leg"><span><i style="background:var(--sc)"></i>${esc(r.name)}</span><span><i style="background:#15191D;width:3px"></i>${A2.groupLabel} 평균 (${A2.groupN}명)</span>${weak ? `<span>가장 보완이 필요한 영역: <b style="color:#C04A2B">${esc(weak.a)}</b></span>` : ''}</div></div>
    <div class="rp-sec"><h4>문항별 결과 <span>${A2.groupLabel}% = ${A2.groupLabel === '반' ? '같은 반' : '학원 전체'} 응시자 정답률</span></h4><div class="rp-items">${tables}</div>
      <p class="rp-note">${hotN ? `<b style="color:#C04A2B">!</b> 표시 ${hotN}문항: ${A2.groupLabel} 정답률 70% 이상인데 틀린 문항 — 먼저 다시 풀어 보세요.` : '빨간 줄 = 틀린 문항'}</p></div>
    ${cmt ? `<div class="rp-cmt"><b>담당 선생님 코멘트</b>${esc(cmt)}</div>` : ''}${foot}</div>`;
}

const R = { exam: null, sid: null, cls: '전체', branch: '전체', list: [] };
function initRep() {
  examOptions('rExam', R.exam);
  if (R.exam && examById(R.exam) && examById(R.exam).status === '확정') pickRepExam(true); else { R.exam = null; $('rBody').hidden = true; $('rFilters').innerHTML = ''; }
}
async function pickRepExam(keep) {
  R.exam = $('rExam').value || null;
  $('rBody').hidden = !R.exam;
  if (!keep) { R.sid = null; R.cls = '전체'; R.branch = '전체'; }
  if (!R.exam) { $('rFilters').innerHTML = ''; return; }
  try { await busy('불러오는 중…', () => loadExam(R.exam, true)); renderRepList(); }
  catch (e) { toast(e.message); }
}
function repFilter(k, v) { R[k] = v; renderRepList(); }
function renderRepList() {
  const d = S.data[R.exam]; if (!d) return;
  const clss = [...new Set(d.responses.map(r => r.cls).filter(Boolean))].sort();
  const brs = [...new Set(d.responses.map(r => r.branch).filter(Boolean))].sort();
  const chip = (k, v) => `<button class="chip" aria-pressed="${R[k] === v}" onclick="repFilter('${k}','${esc(v)}')">${esc(v)}</button>`;
  $('rFilters').innerHTML = (clss.length > 1 ? `<span class="field">반</span><div class="chips">${['전체', ...clss].map(v => chip('cls', v)).join('')}</div>` : '')
    + (brs.length > 1 ? `<span class="field">지점</span><div class="chips">${['전체', ...brs].map(v => chip('branch', v)).join('')}</div>` : '');
  R.list = d.responses.filter(r => (R.cls === '전체' || r.cls === R.cls) && (R.branch === '전체' || r.branch === R.branch))
    .sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || a.name.localeCompare(b.name));
  $('rCount').textContent = `${R.list.length}명`;
  $('rTable').innerHTML = R.list.length ? `<tr><th>이름</th><th>반</th><th class="num">점수</th><th></th></tr>` + R.list.map(r => `<tr class="click${r.sid === R.sid ? ' sel' : ''}" onclick="openReport('${r.sid}')">
    <td><b>${esc(r.name)}</b></td><td>${esc(r.cls)}</td><td class="num">${r.absent ? '결시' : scoreOf(d.items, r.answers).score}</td><td class="hint" style="font-size:12px">${r.comment ? '코멘트' : ''}</td></tr>`).join('')
    : '<tr><td class="empty">답안이 입력된 학생이 없습니다.</td></tr>';
  if (R.sid && R.list.some(r => r.sid === R.sid)) drawReport(); else { $('rView').hidden = true; $('rEmpty').hidden = false; }
}
function curResp() { const d = S.data[R.exam]; return d && d.responses.find(r => r.sid === R.sid); }
function openReport(sid) {
  R.sid = sid; const r = curResp();
  $('rCmt').value = r ? r.comment : ''; $('rCmtMsg').textContent = '';
  renderRepList();
  if (window.innerWidth < 900) $('rView').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function drawReport() {
  const d = S.data[R.exam], r = curResp(); if (!d || !r) return;
  $('rEmpty').hidden = true; $('rView').hidden = false;
  const sc = $('rScale');
  sc.innerHTML = reportHTML(d, r, $('rCmt').value);
  fitReport();
}
function fitReport() {
  const wrap = document.querySelector('.rpwrap'), sc = $('rScale');
  if (!wrap || $('rView').hidden) return;
  const k = Math.min(1, (wrap.clientWidth - 28) / 794);
  sc.style.transform = `scale(${k})`; sc.style.width = '794px';
  wrap.style.height = (1123 * k + 28) + 'px';
}
window.addEventListener('resize', fitReport);
document.addEventListener('input', e => { if (e.target.id === 'rCmt') { $('rCmtMsg').textContent = '저장 안 됨'; drawReport(); } });
function stepStudent(dx) {
  const i = R.list.findIndex(r => r.sid === R.sid);
  const n = R.list[i + dx]; if (n) openReport(n.sid);
}
async function saveComment(silent) {
  const r = curResp(); if (!r) return;
  const v = $('rCmt').value.trim();
  if (v === (r.comment || '')) { if (!silent) $('rCmtMsg').textContent = '저장됨'; return; }
  try {
    await (silent ? api('saveComment', { examId: R.exam, studentId: r.sid, comment: v }) : busy('저장 중…', () => api('saveComment', { examId: R.exam, studentId: r.sid, comment: v })));
    r.comment = v; $('rCmtMsg').textContent = '저장됨'; renderRepList();
  } catch (e) { $('rCmtMsg').textContent = e.message; throw e; }
}
function fileName(ext) {
  const d = S.data[R.exam], r = curResp();
  return `${r.name}_${examTitle(d.exam)}`.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_') + '.' + ext;
}
let libs = null;
function loadScript(src) {
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('저장 도구를 불러오지 못했습니다. 인터넷 연결을 확인하거나 「인쇄」 → PDF로 저장을 쓰세요.')); document.head.appendChild(s); });
}
function loadLibs() {
  if (!libs) libs = Promise.all([
    window.html2canvas ? 0 : loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'),
    (window.jspdf && window.jspdf.jsPDF) ? 0 : loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
  ]).catch(e => { libs = null; throw e; });
  return libs;
}
async function renderCanvas() {
  const d = S.data[R.exam], r = curResp();
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-12000px;top:0;width:794px;z-index:-1';
  holder.innerHTML = reportHTML(d, r, $('rCmt').value);
  document.body.appendChild(holder);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all([...holder.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(ok => { im.onload = im.onerror = ok; })));
    return await window.html2canvas(holder.firstElementChild, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, width: 794, height: 1123, windowWidth: 1100 });
  } finally { holder.remove(); }
}
async function exportReport(kind) {
  if (!curResp()) return;
  try {
    await busy(kind === 'pdf' ? 'PDF 만드는 중…' : 'PNG 만드는 중…', async () => {
      try { await saveComment(true); } catch (e) { /* 코멘트 저장 실패해도 파일은 만든다 */ }
      await loadLibs();
      const canvas = await renderCanvas();
      if (kind === 'png') {
        const blob = await new Promise(ok => canvas.toBlob(ok, 'image/png'));
        download(blob, fileName('png'));
      } else {
        const pdf = new window.jspdf.jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.93), 'JPEG', 0, 0, 210, 297);
        pdf.save(fileName('pdf'));
      }
    });
    toast(`${curResp().name} 리포트를 저장했습니다.`);
  } catch (e) { toast(e.message); }
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function printReport() {
  const d = S.data[R.exam], r = curResp(); if (!r) return;
  $('printArea').innerHTML = reportHTML(d, r, $('rCmt').value);
  setTimeout(() => window.print(), 100);
}

/* ================= 체험 모드 (가짜 서버) ================= */
const Demo = (() => {
  const db = { exams: [], items: [], students: [], responses: [] };
  const types = [];
  [[1, 17, '듣기', '듣기'], [18, 18, '대의 파악', '글의 목적'], [19, 19, '대의 파악', '심경·분위기'], [20, 20, '대의 파악', '필자의 주장'], [21, 21, '대의 파악', '함축 의미'],
   [22, 22, '대의 파악', '요지'], [23, 23, '대의 파악', '주제'], [24, 24, '대의 파악', '제목'], [25, 25, '세부 정보', '도표'], [26, 26, '세부 정보', '내용 일치(인물·소재)'],
   [27, 28, '세부 정보', '안내문 일치·불일치'], [29, 29, '어법·어휘', '어법'], [30, 30, '어법·어휘', '어휘'], [31, 34, '빈칸 추론', '빈칸'], [35, 35, '간접 쓰기', '무관한 문장'],
   [36, 37, '간접 쓰기', '글의 순서'], [38, 39, '간접 쓰기', '문장 삽입'], [40, 40, '간접 쓰기', '요약문 완성'], [41, 42, '장문', '장문(제목·어휘)'], [43, 45, '장문', '장문(순서·지칭·내용)']]
    .forEach(r => { for (let n = r[0]; n <= r[1]; n++) types.push({ no: n, area: r[2], type: r[3] }); });
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const now = () => { const d = new Date(Date.now() + 9 * 3600e3).toISOString(); return d.slice(0, 10) + ' ' + d.slice(11, 16); };
  const names = [['김민준', '고2 국어 A반', '목동관'], ['이서연', '고2 국어 A반', '목동관'], ['박도윤', '고2 국어 A반', '목동관'], ['최지우', '고2 국어 A반', '목동관'],
    ['정하준', '고2 국어 B반', '김포관'], ['강서윤', '고2 국어 B반', '김포관'], ['조시우', '고2 국어 B반', '김포관'], ['윤지민', '고2 국어 B반', '김포관'], ['장예준', '고2 국어 A반', '목동관']];
  names.forEach((x, i) => db.students.push({ id: 'S' + String(i + 1).padStart(4, '0'), name: x[0], grade: '고2', cls: x[1], branch: x[2] }));
  function addExam(e, areaText, p3) {
    const ans = Array.from({ length: 45 }, () => 1 + Math.floor(rnd() * 5));
    const ar = parseAreas(areaText, 45).areas;
    db.exams.push(Object.assign({ n: 45, memo: '', by: '김조교', at: '2026-11-01 18:20', confirmedBy: e.status === '확정' ? '김동완' : '', confirmedAt: e.status === '확정' ? '2026-11-01 21:05' : '', cuts: '' }, e));
    ans.forEach((a, i) => db.items.push({ eid: e.id, no: i + 1, ans: a, pt: p3.includes(i + 1) ? 3 : 2, area: ar[i], type: e.subject === '영어' ? (types[i].area === ar[i] ? types[i].type : '') : '' }));
    return ans;
  }
  function fillResponses(eid, ans, clsOf) {
    const diff = ans.map(() => 0.35 + rnd() * 0.6);
    db.students.forEach((s, k) => {
      const skill = 0.55 + rnd() * 0.45;
      const a = ans.map((x, i) => rnd() < skill * diff[i] + 0.12 ? x : ((x + Math.floor(rnd() * 4)) % 5) + 1).join('');
      db.responses.push({ eid, sid: s.id, cls: clsOf(s), answers: k === 8 ? '' : a, absent: k === 8, comment: k === 0 ? '독서 과학 지문에서 시간 배분이 흔들렸습니다. 다음 주 클리닉에서 3점 추론 문항을 집중해서 다룹니다.' : '', by: '김조교', at: '2026-11-03 19:40' });
    });
  }
  const P3 = [5, 11, 17, 22, 29, 33, 38, 41, 43, 45];
  const ko = addExam({ id: 'KO-2026-09-G2-E', subject: '국어', grade: '고2', year: 2026, month: 9, org: '교육청', name: '2026년 9월 고2 국어 (교육청)', date: '2026-09-03', status: '확정' },
    '1-3 화법 / 4-7 작문 / 8-10 화법 / 11-15 문법 / 16-32 독서 / 33-45 문학', P3);
  fillResponses('KO-2026-09-G2-E', ko, s => s.cls);
  const en = addExam({ id: 'EN-2026-10-G2-E', subject: '영어', grade: '고2', year: 2026, month: 10, org: '교육청', name: '2026년 10월 고2 영어 (교육청)', date: '2026-10-21', status: '확정' },
    areasToText(types.map(t => t.area)), [18, 21, 29, 31, 33, 34, 37, 39, 40, 42].concat([]).slice(0, 10));
  fillResponses('EN-2026-10-G2-E', en, s => s.cls.replace('국어', '영어'));
  addExam({ id: 'EN-2026-11-G1-E', subject: '영어', grade: '고1', year: 2026, month: 11, org: '교육청', name: '2026년 11월 고1 영어 (교육청)', date: '2026-11-19', status: '확정대기' },
    areasToText(types.map(t => t.area)), [19, 21, 29, 32, 33, 34, 37, 39, 40, 42]);

  const ok = o => Object.assign({ ok: true }, o || {});
  const fail = m => ({ ok: false, error: m });
  const ex = id => db.exams.find(e => e.id === id);
  function handle(q) {
    const role = q.pw === '9999' ? 'admin' : q.pw === '1111' ? 'staff' : null;
    if (!role) return { ok: false, error: '비밀번호가 맞지 않습니다. (체험용: 직원 1111 · 확정 9999)', auth: true };
    const adminOnly = ['confirmExam', 'requestFix', 'unconfirmExam', 'deleteExam'];
    if (adminOnly.includes(q.action) && role !== 'admin') return fail('확정 비밀번호로 들어와야 할 수 있는 작업입니다.');
    switch (q.action) {
      case 'login': return ok({ role });
      case 'bootstrap': return ok({ role, types: types.slice(), students: db.students.slice(),
        exams: db.exams.map(e => Object.assign({}, e, { count: db.responses.filter(r => r.eid === e.id).length })) });
      case 'getExam': {
        const e = ex(q.id); if (!e) return fail('시험을 찾을 수 없습니다.');
        return ok({ exam: Object.assign({}, e), items: db.items.filter(i => i.eid === q.id).map(i => ({ no: i.no, ans: i.ans, pt: i.pt, area: i.area, type: i.type })),
          responses: db.responses.filter(r => r.eid === q.id).map(r => { const s = db.students.find(x => x.id === r.sid) || {}; return { sid: r.sid, name: s.name, grade: s.grade, branch: s.branch, cls: r.cls, answers: r.answers, absent: r.absent, comment: r.comment, by: r.by, at: r.at }; }) });
      }
      case 'saveExam': {
        const e = q.exam, id = e.id || `${e.subject === '국어' ? 'KO' : 'EN'}-${e.year}-${String(e.month).padStart(2, '0')}-${e.grade.replace('고', 'G')}-${{ 교육청: 'E', 평가원: 'P', 수능: 'S' }[e.org]}`;
        const old = ex(id);
        if (old && !e.id) return fail('이미 등록된 시험입니다: ' + old.name + '. 시험 목록에서 그 시험을 눌러 고쳐 주세요.');
        if (old && old.status === '확정' && role !== 'admin') return fail('확정된 시험은 확정 비밀번호로만 고칠 수 있습니다.');
        const status = old && old.status === '확정' ? '확정' : '확정대기';
        const rec = Object.assign(old || { id, by: q.who, at: now() }, { subject: e.subject, grade: e.grade, year: e.year, month: e.month, org: e.org, date: e.date, n: 45,
          name: `${e.year}년 ${e.month}월 ${e.grade} ${e.subject} (${e.org})`, status, memo: status === '확정' && old ? old.memo : '' });
        if (!old) db.exams.push(rec);
        db.items = db.items.filter(i => i.eid !== id).concat(q.items.map(i => Object.assign({ eid: id }, i)));
        return ok({ id, status });
      }
      case 'confirmExam': { const e = ex(q.id); Object.assign(e, { status: '확정', memo: '', confirmedBy: q.who, confirmedAt: now() }); return ok({ status: '확정' }); }
      case 'requestFix': { const e = ex(q.id); Object.assign(e, { status: '수정요청', memo: q.memo, confirmedBy: '', confirmedAt: '' }); return ok({ status: '수정요청' }); }
      case 'unconfirmExam': { const e = ex(q.id); Object.assign(e, { status: '확정대기', memo: '', confirmedBy: '', confirmedAt: '' }); return ok({ status: '확정대기' }); }
      case 'deleteExam': {
        if (db.responses.some(r => r.eid === q.id)) return fail('이미 학생 답안이 입력된 시험은 지울 수 없습니다. 답안을 먼저 지워 주세요.');
        db.exams = db.exams.filter(e => e.id !== q.id); db.items = db.items.filter(i => i.eid !== q.id); return ok();
      }
      case 'addStudent': {
        const max = db.students.reduce((m, s) => Math.max(m, +s.id.slice(1)), 0);
        const s = { id: 'S' + String(max + 1).padStart(4, '0'), name: q.student.name, grade: q.student.grade, cls: q.student.cls, branch: q.student.branch };
        db.students.push(s); return ok({ student: s });
      }
      case 'saveResponse': {
        const e = ex(q.examId); if (!e || e.status !== '확정') return fail('아직 확정되지 않은 시험입니다.');
        if (!q.absent && !/^[0-5]{45}$/.test(q.answers)) return fail('답안은 0~5 숫자 45개여야 합니다.');
        let r = db.responses.find(x => x.eid === q.examId && x.sid === q.studentId);
        const updated = !!r;
        if (!r) { r = { eid: q.examId, sid: q.studentId, comment: '', by: q.who }; db.responses.push(r); }
        Object.assign(r, { cls: q.cls, answers: q.absent ? '' : q.answers, absent: !!q.absent, at: now() });
        const s = db.students.find(x => x.id === q.studentId); if (s && q.cls) s.cls = q.cls;
        return ok({ updated });
      }
      case 'deleteResponse': db.responses = db.responses.filter(r => !(r.eid === q.examId && r.sid === q.studentId)); return ok();
      case 'saveComment': { const r = db.responses.find(x => x.eid === q.examId && x.sid === q.studentId); if (!r) return fail('답안이 입력되지 않은 학생입니다.'); r.comment = q.comment; return ok(); }
    }
    return fail('알 수 없는 요청입니다.');
  }
  return { handle };
})();

initGate();
