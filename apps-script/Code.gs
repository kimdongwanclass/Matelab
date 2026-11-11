/**
 * 메이트랩 모의고사 분석 — 구글 시트 서버 (Apps Script)
 *
 * 이 코드는 「메이트 모의고사」 구글 시트의 [확장 프로그램 → Apps Script]에 붙여 넣어 씁니다.
 * - 시트 메뉴 「메이트 모의고사」 → ① 처음 설정 → ② 비밀번호 설정 → 웹 앱으로 배포
 * - 메이트랩 화면(mock.html)이 이 웹 앱 주소로 저장·읽기를 요청합니다.
 * - 모든 요청은 직원 비밀번호를 함께 보내야 처리됩니다. 주소만 알아서는 읽을 수 없습니다.
 *
 * 탭 5개: 시험 · 문항 · 학생 · 응답 · 유형표
 * 점수·정답률은 저장하지 않고 화면에서 그때그때 계산합니다(정답을 고치면 전부 자동으로 다시 맞춰짐).
 */

var TZ = 'Asia/Seoul';
var VERSION = '1.0';

var SHEETS = {
  '시험': ['시험ID', '과목', '학년', '연도', '월', '시행기관', '시험명', '응시일', '문항수', '상태', '메모', '등록자', '등록일', '확정자', '확정일', '등급컷'],
  '문항': ['시험ID', '문항번호', '정답', '배점', '대분류', '세부유형'],
  '학생': ['학생ID', '이름', '학년', '반', '지점', '숨김', '등록일'],
  '응답': ['시험ID', '학생ID', '반', '답안', '결시', '코멘트', '입력자', '입력일', '수정일'],
  '유형표': ['문항번호', '대분류', '유형']
};

// 영어 모의고사·수능 문항번호별 기본 유형 (설계 문서 기준, 원장 확인 후 시트에서 직접 고쳐도 됨)
var EN_TYPES = [
  [1, 17, '듣기', '듣기'],
  [18, 18, '대의 파악', '글의 목적'],
  [19, 19, '대의 파악', '심경·분위기'],
  [20, 20, '대의 파악', '필자의 주장'],
  [21, 21, '대의 파악', '함축 의미'],
  [22, 22, '대의 파악', '요지'],
  [23, 23, '대의 파악', '주제'],
  [24, 24, '대의 파악', '제목'],
  [25, 25, '세부 정보', '도표'],
  [26, 26, '세부 정보', '내용 일치(인물·소재)'],
  [27, 28, '세부 정보', '안내문 일치·불일치'],
  [29, 29, '어법·어휘', '어법'],
  [30, 30, '어법·어휘', '어휘'],
  [31, 34, '빈칸 추론', '빈칸'],
  [35, 35, '간접 쓰기', '무관한 문장'],
  [36, 37, '간접 쓰기', '글의 순서'],
  [38, 39, '간접 쓰기', '문장 삽입'],
  [40, 40, '간접 쓰기', '요약문 완성'],
  [41, 42, '장문', '장문(제목·어휘)'],
  [43, 45, '장문', '장문(순서·지칭·내용)']
];

/* ================= 시트 메뉴 ================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('메이트 모의고사')
    .addItem('① 처음 설정 (탭 만들기)', 'setupSheets')
    .addItem('② 비밀번호 설정', 'setPasswords')
    .addSeparator()
    .addItem('설정 상태 확인', 'checkSetup')
    .addToUi();
}

/** 탭 5개를 만들고 머리줄·유형표를 채웁니다. 여러 번 눌러도 기존 데이터는 지우지 않습니다. */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#FCEBDD');
    sh.setFrozenRows(1);
  });
  // 답안·응시일 칸은 숫자로 바뀌지 않게 글자 형식으로
  ss.getSheetByName('응답').getRange('D:D').setNumberFormat('@');
  ss.getSheetByName('시험').getRange('H:H').setNumberFormat('@');
  var t = ss.getSheetByName('유형표');
  if (t.getLastRow() < 2) {
    var rows = [];
    EN_TYPES.forEach(function (r) { for (var n = r[0]; n <= r[1]; n++) rows.push([n, r[2], r[3]]); });
    t.getRange(2, 1, rows.length, 3).setValues(rows);
  }
  // 처음 만든 빈 '시트1'은 지움
  var first = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 5 && first.getLastRow() === 0) ss.deleteSheet(first);
  SpreadsheetApp.getUi().alert('처음 설정 완료', '탭 5개(시험·문항·학생·응답·유형표)를 만들었습니다.\n다음으로 메뉴의 「② 비밀번호 설정」을 눌러 주세요.', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 직원 비밀번호(조교·강사)와 확정 비밀번호(원장·강사)를 정합니다. 시트에는 남지 않습니다. */
function setPasswords() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('직원 비밀번호 (조교·강사용)', '시험 등록·답안 입력·리포트에 쓰는 비밀번호입니다. 4자 이상.', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var staff = a.getResponseText().trim();
  var b = ui.prompt('확정 비밀번호 (원장·강사용)', '정답표 확정·수정 요청·시험 삭제까지 할 수 있는 비밀번호입니다. 직원 비밀번호와 달라야 합니다. 4자 이상.', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  var admin = b.getResponseText().trim();
  if (staff.length < 4 || admin.length < 4) { ui.alert('비밀번호는 4자 이상이어야 합니다. 다시 눌러 주세요.'); return; }
  if (staff === admin) { ui.alert('두 비밀번호가 같습니다. 서로 다르게 정해 주세요.'); return; }
  var p = PropertiesService.getScriptProperties();
  p.setProperty('STAFF_PW', hash_(staff));
  p.setProperty('ADMIN_PW', hash_(admin));
  ui.alert('비밀번호를 저장했습니다.\n바꾸고 싶으면 언제든 이 메뉴를 다시 누르면 됩니다.');
}

function checkSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var p = PropertiesService.getScriptProperties();
  var miss = Object.keys(SHEETS).filter(function (n) { return !ss.getSheetByName(n); });
  var msg = [];
  msg.push(miss.length ? '✗ 없는 탭: ' + miss.join(', ') + ' → 「① 처음 설정」을 누르세요.' : '✓ 탭 5개 있음');
  msg.push(p.getProperty('STAFF_PW') && p.getProperty('ADMIN_PW') ? '✓ 비밀번호 설정됨' : '✗ 비밀번호 없음 → 「② 비밀번호 설정」을 누르세요.');
  msg.push('서버 버전 ' + VERSION);
  SpreadsheetApp.getUi().alert(msg.join('\n'));
}

/* ================= 웹 앱 ================= */

function doGet() {
  return ContentService.createTextOutput('메이트 모의고사 서버가 작동 중입니다. (버전 ' + VERSION + ')\n이 주소를 메이트랩 담당자에게 알려 주세요.');
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handle_(req);
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

var ACTIONS = {
  login:          { role: 'staff', write: false },
  bootstrap:      { role: 'staff', write: false },
  getExam:        { role: 'staff', write: false },
  saveExam:       { role: 'staff', write: true },
  confirmExam:    { role: 'admin', write: true },
  requestFix:     { role: 'admin', write: true },
  unconfirmExam:  { role: 'admin', write: true },
  deleteExam:     { role: 'admin', write: true },
  addStudent:     { role: 'staff', write: true },
  saveResponse:   { role: 'staff', write: true },
  deleteResponse: { role: 'staff', write: true },
  saveComment:    { role: 'staff', write: true }
};

function handle_(req) {
  var spec = ACTIONS[req.action];
  if (!spec) return { ok: false, error: '알 수 없는 요청입니다.' };
  var role = auth_(req.pw);
  if (!role) return { ok: false, error: '비밀번호가 맞지 않습니다.', auth: true };
  if (spec.role === 'admin' && role !== 'admin') return { ok: false, error: '확정 비밀번호로 들어와야 할 수 있는 작업입니다.' };
  var who = String(req.who || '').slice(0, 20);
  if (!spec.write) return api_[req.action](req, role, who);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return api_[req.action](req, role, who); }
  finally { lock.releaseLock(); }
}

/** 비밀번호 확인. 10분 안에 10번 틀리면 10분 동안 모든 입장을 막습니다. */
function auth_(pw) {
  var p = PropertiesService.getScriptProperties();
  var staff = p.getProperty('STAFF_PW'), admin = p.getProperty('ADMIN_PW');
  if (!staff || !admin) throw new Error('서버에 비밀번호가 아직 설정되지 않았습니다. 시트 메뉴에서 「② 비밀번호 설정」을 해 주세요.');
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('fails') || 0);
  if (fails >= 10) throw new Error('비밀번호를 여러 번 틀려 10분 동안 잠겼습니다. 잠시 후 다시 시도해 주세요.');
  var h = hash_(String(pw || '').trim());
  if (h === admin) return 'admin';
  if (h === staff) return 'staff';
  cache.put('fails', String(fails + 1), 600);
  return null;
}

var api_ = {
  login: function (req, role) { return { ok: true, role: role, version: VERSION }; },

  bootstrap: function (req, role) {
    var types = rows_('유형표').map(function (r) { return { no: Number(r['문항번호']), area: r['대분류'], type: r['유형'] }; });
    var students = rows_('학생').filter(function (r) { return !truthy_(r['숨김']); }).map(studentOut_);
    var counts = {};
    rows_('응답').forEach(function (r) { counts[r['시험ID']] = (counts[r['시험ID']] || 0) + 1; });
    var exams = rows_('시험').map(function (r) { var x = examOut_(r); x.count = counts[x.id] || 0; return x; });
    return { ok: true, role: role, exams: exams, students: students, types: types, version: VERSION };
  },

  getExam: function (req) {
    var ex = find_('시험', '시험ID', req.id);
    if (!ex) return { ok: false, error: '시험을 찾을 수 없습니다.' };
    var items = rows_('문항').filter(function (r) { return r['시험ID'] === req.id; }).map(itemOut_)
      .sort(function (a, b) { return a.no - b.no; });
    var stu = {};
    rows_('학생').forEach(function (r) { stu[r['학생ID']] = r; });
    var responses = rows_('응답').filter(function (r) { return r['시험ID'] === req.id; }).map(function (r) {
      var s = stu[r['학생ID']] || {};
      return { sid: r['학생ID'], name: s['이름'] || '(삭제된 학생)', grade: s['학년'] || '', branch: s['지점'] || '',
        cls: r['반'] || s['반'] || '', answers: String(r['답안'] || ''), absent: truthy_(r['결시']),
        comment: r['코멘트'] || '', by: r['입력자'] || '', at: r['수정일'] || r['입력일'] || '' };
    });
    return { ok: true, exam: examOut_(ex.row), items: items, responses: responses };
  },

  saveExam: function (req, role, who) {
    var e = req.exam || {}, items = req.items || [];
    var subj = e.subject, n = Number(e.n || 45);
    if (['국어', '영어'].indexOf(subj) < 0) return { ok: false, error: '과목은 국어 또는 영어여야 합니다.' };
    if (['고1', '고2', '고3'].indexOf(e.grade) < 0) return { ok: false, error: '학년을 골라 주세요.' };
    if (['교육청', '평가원', '수능'].indexOf(e.org) < 0) return { ok: false, error: '시행기관을 골라 주세요.' };
    var y = Number(e.year), m = Number(e.month);
    if (!(y >= 2024 && y <= 2040) || !(m >= 1 && m <= 12)) return { ok: false, error: '연도·월을 확인해 주세요.' };
    if (items.length !== n) return { ok: false, error: '문항 수가 맞지 않습니다.' };
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (Number(it.no) !== i + 1) return { ok: false, error: '문항 번호가 순서대로가 아닙니다.' };
      if (!(Number(it.ans) >= 1 && Number(it.ans) <= 5)) return { ok: false, error: (i + 1) + '번 정답이 1~5가 아닙니다.' };
      if (!(Number(it.pt) > 0)) return { ok: false, error: (i + 1) + '번 배점이 비었습니다.' };
      if (!it.area) return { ok: false, error: (i + 1) + '번 영역이 비었습니다.' };
    }
    var id = e.id || makeExamId_(subj, y, m, e.grade, e.org);
    var name = y + '년 ' + m + '월 ' + e.grade + ' ' + subj + (e.org === '수능' ? ' (수능)' : e.org === '평가원' ? ' (평가원)' : ' (교육청)');
    var found = find_('시험', '시험ID', id);
    var now = now_();
    var status = '확정대기';
    if (found) {
      if (!e.id) return { ok: false, error: '이미 등록된 시험입니다: ' + found.row['시험명'] + '. 시험 목록에서 그 시험을 눌러 고쳐 주세요.' };
      if (found.row['상태'] === '확정') {
        if (role !== 'admin') return { ok: false, error: '확정된 시험은 확정 비밀번호로만 고칠 수 있습니다.' };
        status = '확정';   // 원장이 직접 고친 경우 확정 유지
      }
    } else if (role === 'admin' && e.confirmNow) {
      status = '확정';
    }
    var record = {
      '시험ID': id, '과목': subj, '학년': e.grade, '연도': y, '월': m, '시행기관': e.org, '시험명': name,
      '응시일': e.date || '', '문항수': n, '상태': status, '메모': found ? (status === '확정' ? found.row['메모'] : '') : '',
      '등록자': found ? found.row['등록자'] : who, '등록일': found ? found.row['등록일'] : now,
      '확정자': status === '확정' ? (found && found.row['확정자'] ? found.row['확정자'] : who) : '',
      '확정일': status === '확정' ? (found && found.row['확정일'] ? found.row['확정일'] : now) : '',
      '등급컷': e.cuts || (found ? found.row['등급컷'] : '')
    };
    upsert_('시험', found, record);
    // 문항: 이 시험의 기존 줄을 지우고 새로 씀
    deleteWhere_('문항', function (r) { return r['시험ID'] === id; });
    appendRows_('문항', items.map(function (it) {
      return { '시험ID': id, '문항번호': Number(it.no), '정답': Number(it.ans), '배점': Number(it.pt), '대분류': it.area, '세부유형': it.type || '' };
    }));
    return { ok: true, id: id, status: status };
  },

  confirmExam: function (req, role, who) { return setStatus_(req.id, '확정', '', who); },
  requestFix: function (req, role, who) { return setStatus_(req.id, '수정요청', String(req.memo || '').slice(0, 300), who); },
  unconfirmExam: function (req, role, who) { return setStatus_(req.id, '확정대기', '', who); },

  deleteExam: function (req) {
    var found = find_('시험', '시험ID', req.id);
    if (!found) return { ok: false, error: '시험을 찾을 수 없습니다.' };
    var used = rows_('응답').some(function (r) { return r['시험ID'] === req.id; });
    if (used) return { ok: false, error: '이미 학생 답안이 입력된 시험은 지울 수 없습니다. 답안을 먼저 지워 주세요.' };
    deleteWhere_('문항', function (r) { return r['시험ID'] === req.id; });
    deleteWhere_('시험', function (r) { return r['시험ID'] === req.id; });
    return { ok: true };
  },

  addStudent: function (req) {
    var s = req.student || {};
    var name = String(s.name || '').trim();
    if (!name) return { ok: false, error: '이름을 입력해 주세요.' };
    var all = rows_('학생');
    var max = 0;
    all.forEach(function (r) { var k = Number(String(r['학생ID']).replace(/\D/g, '')); if (k > max) max = k; });
    var id = 'S' + ('0000' + (max + 1)).slice(-4);
    var rec = { '학생ID': id, '이름': name, '학년': s.grade || '', '반': String(s.cls || '').trim(), '지점': s.branch || '', '숨김': '', '등록일': now_() };
    appendRows_('학생', [rec]);
    return { ok: true, student: studentOut_(rec) };
  },

  saveResponse: function (req, role, who) {
    var ex = find_('시험', '시험ID', req.examId);
    if (!ex) return { ok: false, error: '시험을 찾을 수 없습니다.' };
    if (ex.row['상태'] !== '확정') return { ok: false, error: '아직 확정되지 않은 시험입니다. 원장 확정 후 입력할 수 있습니다.' };
    if (!find_('학생', '학생ID', req.studentId)) return { ok: false, error: '학생을 찾을 수 없습니다.' };
    var n = Number(ex.row['문항수']);
    var absent = !!req.absent;
    var ans = String(req.answers || '').replace(/\s/g, '');
    if (!absent && !new RegExp('^[0-5]{' + n + '}$').test(ans)) return { ok: false, error: '답안은 0~5 숫자 ' + n + '개여야 합니다. (지금 ' + ans.length + '개)' };
    if (absent) ans = '';
    var found = null;
    var data = rows_('응답');
    for (var i = 0; i < data.length; i++) {
      if (data[i]['시험ID'] === req.examId && data[i]['학생ID'] === req.studentId) { found = { index: data[i]._r, row: data[i] }; break; }
    }
    var now = now_();
    var rec = { '시험ID': req.examId, '학생ID': req.studentId, '반': String(req.cls || '').trim(), '답안': ans, '결시': absent ? 'Y' : '',
      '코멘트': found ? found.row['코멘트'] : '', '입력자': found ? found.row['입력자'] : who,
      '입력일': found ? found.row['입력일'] : now, '수정일': found ? now : '' };
    upsert_('응답', found, rec);
    // 학생의 기본 반을 마지막으로 쓴 반으로 맞춤
    if (rec['반']) {
      var st = find_('학생', '학생ID', req.studentId);
      if (st && st.row['반'] !== rec['반']) setCell_('학생', st.index, '반', rec['반']);
    }
    return { ok: true, updated: !!found };
  },

  deleteResponse: function (req) {
    var n = deleteWhere_('응답', function (r) { return r['시험ID'] === req.examId && r['학생ID'] === req.studentId; });
    return n ? { ok: true } : { ok: false, error: '지울 답안을 찾지 못했습니다.' };
  },

  saveComment: function (req) {
    var data = rows_('응답');
    for (var i = 0; i < data.length; i++) {
      if (data[i]['시험ID'] === req.examId && data[i]['학생ID'] === req.studentId) {
        setCell_('응답', data[i]._r, '코멘트', String(req.comment || '').slice(0, 500));
        return { ok: true };
      }
    }
    return { ok: false, error: '답안이 입력되지 않은 학생입니다.' };
  }
};

/* ================= 내부 도우미 ================= */

function setStatus_(id, status, memo, who) {
  var found = find_('시험', '시험ID', id);
  if (!found) return { ok: false, error: '시험을 찾을 수 없습니다.' };
  if (status !== '확정' && found.row['상태'] === '확정') {
    var used = rows_('응답').some(function (r) { return r['시험ID'] === id; });
    if (used && status === '수정요청') return { ok: false, error: '이미 답안이 입력된 시험입니다. 「확정 해제」 후 직접 고쳐 주세요.' };
  }
  setCell_('시험', found.index, '상태', status);
  setCell_('시험', found.index, '메모', memo);
  setCell_('시험', found.index, '확정자', status === '확정' ? who : '');
  setCell_('시험', found.index, '확정일', status === '확정' ? now_() : '');
  return { ok: true, status: status };
}

function makeExamId_(subj, y, m, grade, org) {
  return (subj === '국어' ? 'KO' : 'EN') + '-' + y + '-' + ('0' + m).slice(-2) + '-' + grade.replace('고', 'G') + '-' + ({ '교육청': 'E', '평가원': 'P', '수능': 'S' }[org]);
}

function examOut_(r) {
  return { id: r['시험ID'], subject: r['과목'], grade: r['학년'], year: Number(r['연도']), month: Number(r['월']), org: r['시행기관'],
    name: r['시험명'], date: r['응시일'], n: Number(r['문항수'] || 45), status: r['상태'], memo: r['메모'],
    by: r['등록자'], at: r['등록일'], confirmedBy: r['확정자'], confirmedAt: r['확정일'], cuts: r['등급컷'] };
}
function itemOut_(r) {
  return { no: Number(r['문항번호']), ans: Number(r['정답']), pt: Number(r['배점']), area: r['대분류'], type: r['세부유형'] || '' };
}
function studentOut_(r) {
  return { id: r['학생ID'], name: r['이름'], grade: r['학년'], cls: r['반'], branch: r['지점'] };
}

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('「' + name + '」 탭이 없습니다. 시트 메뉴에서 「① 처음 설정」을 눌러 주세요.');
  return sh;
}

/** 탭 전체를 머리줄 이름을 키로 하는 객체 배열로 읽습니다. */
function rows_(name) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = SHEETS[name];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  return vals.map(function (v, idx) {
    var o = { _r: idx + 2 };   // _r = 시트에서의 실제 줄 번호
    head.forEach(function (h, i) { o[h] = v[i] instanceof Date ? Utilities.formatDate(v[i], TZ, 'yyyy-MM-dd') : (typeof v[i] === 'string' ? v[i] : v[i]); });
    if (typeof o[head[0]] !== 'string') o[head[0]] = String(o[head[0]]);
    if (name === '응답' || name === '문항') { o['시험ID'] = String(o['시험ID']); }
    if (name === '응답') { o['학생ID'] = String(o['학생ID']); }
    return o;
  }).filter(function (o) { return o[head[0]] !== ''; });
}

function find_(name, key, val) {
  var data = rows_(name);
  for (var i = 0; i < data.length; i++) if (String(data[i][key]) === String(val)) return { index: data[i]._r, row: data[i] };
  return null;
}

/** 글자가 숫자·날짜로 바뀌지 않도록 문자열 앞에 ' 를 붙여 씁니다. */
function cell_(v) {
  if (typeof v === 'string' && v !== '') return "'" + v;
  return v;
}
function toRow_(name, rec) { return SHEETS[name].map(function (h) { return cell_(rec[h] === undefined ? '' : rec[h]); }); }

function upsert_(name, found, rec) {
  var sh = sheet_(name);
  if (found) sh.getRange(found.index, 1, 1, SHEETS[name].length).setValues([toRow_(name, rec)]);
  else appendRows_(name, [rec]);
}
function appendRows_(name, recs) {
  if (!recs.length) return;
  var sh = sheet_(name);
  var start = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(start, 1, recs.length, SHEETS[name].length).setValues(recs.map(function (r) { return toRow_(name, r); }));
}
function setCell_(name, rowIndex, key, val) {
  sheet_(name).getRange(rowIndex, SHEETS[name].indexOf(key) + 1).setValue(cell_(val));
}
/** 조건에 맞는 줄을 빼고 탭을 다시 씁니다(한 번에 처리해서 빠름). 지운 줄 수를 돌려줍니다. */
function deleteWhere_(name, test) {
  var sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return 0;
  var head = SHEETS[name], w = head.length;
  var vals = sh.getRange(2, 1, last - 1, w).getValues();
  var keep = [], n = 0;
  vals.forEach(function (v) {
    if (String(v[0]) === '') return;
    var o = {};
    head.forEach(function (h, k) { o[h] = v[k] instanceof Date ? Utilities.formatDate(v[k], TZ, 'yyyy-MM-dd') : String(v[k]); });
    if (test(o)) n++; else keep.push(v.map(cell_));
  });
  if (!n) return 0;
  sh.getRange(2, 1, last - 1, w).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, w).setValues(keep);
  return n;
}

function truthy_(v) { return v === true || String(v).toUpperCase() === 'Y' || String(v).toUpperCase() === 'TRUE'; }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function hash_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'MATEMOCK:' + s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
