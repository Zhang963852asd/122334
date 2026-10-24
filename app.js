/* ============================================================
   知行 · 月考后学习提升计划
   原生 JS · localStorage 持久化
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  var KEY = 'zhixing.study.plan.v1';
  var VIEWS = ['overview', 'daily', 'weekly', 'plan', 'settings'];
  var WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var SUBJECT_COLOR = { '语文': '#b05a41', '文综': '#a4803f', '英语': '#4a7368', '数理化': '#3f5a3f' };
  var RING_C = 2 * Math.PI * 58;

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return mqReduce.matches; }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function dateKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseKey(k) {
    var p = String(k).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }
  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var back = (x.getDay() + 6) % 7; // 周一为一周开始
    return addDays(x, -back);
  }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return { year: t.getUTCFullYear(), week: week, key: t.getUTCFullYear() + '-W' + week };
  }
  function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function shortTime(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* ---------------- 数据 ---------------- */
  function defaultState() {
    return {
      nickname: '',
      startDate: dateKey(new Date()),
      settings: { dailyReminder: true, weekendReminder: true },
      checkins: {},
      reviews: {},
      goals: {}
    };
  }

  var state = loadState();
  var dailyDate = new Date();
  var activeView = 'overview';
  var ringShown = 0;
  var storageWarned = false;
  var reviewWeekKey = null;

  function loadState() {
    var base = defaultState();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return base;
      var p = JSON.parse(raw);
      if (!p || typeof p !== 'object') return base;
      return {
        nickname: typeof p.nickname === 'string' ? p.nickname : '',
        startDate: p.startDate || base.startDate,
        settings: Object.assign({}, base.settings, p.settings || {}),
        checkins: p.checkins && typeof p.checkins === 'object' ? p.checkins : {},
        reviews: p.reviews && typeof p.reviews === 'object' ? p.reviews : {},
        goals: p.goals && typeof p.goals === 'object' ? p.goals : {}
      };
    } catch (e) {
      return base;
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        toast('浏览器禁止本地存储，本次修改无法保存');
      }
    }
  }

  /* ---------------- 任务生成 ---------------- */
  function tasksFor(date) {
    var dow = date.getDay();
    var dom = date.getDate();

    if (dow >= 1 && dow <= 5) {
      var oddDay = dom % 2 === 1;
      return [
        { id: 'cn-basic', subject: '语文', tag: '语文重点', title: '语文基础', desc: '字音字形 5 组 + 古诗文默写 2 句', min: 15 },
        { id: 'cn-read', subject: '语文', tag: '语文重点', title: '语文阅读', desc: '一篇现代文，只练审题与分点作答', min: 20 },
        { id: 'cn-write', subject: '语文', tag: '语文重点', title: '语文作文', desc: '写一个分论点，或背一句能直接用的素材', min: 10 },
        {
          id: 'humanities', subject: '文综',
          title: oddDay ? '政治背诵' : '历史背诵',
          desc: oddDay ? '先背框架，再补两个关键词' : '把时间轴和三个因果链写一遍',
          min: 15
        },
        { id: 'english', subject: '英语', title: '英语单词', desc: '30 个高频词 + 3 个长难句，只求读懂', min: 10 },
        { id: 'science', subject: '数理化', title: '数理化', desc: '中档题 5 道，错题当场写清错因', min: 15 }
      ];
    }

    if (dow === 6) {
      return [
        { id: 'cn-read-40', subject: '语文', tag: '语文重点', title: '语文限时阅读', desc: '40 分钟整卷阅读，按考试节奏走', min: 40 },
        { id: 'humanities-sub', subject: '文综', title: '文综主观题', desc: '政治材料题、历史小论文各一道，写完整答案', min: 30 },
        { id: 'science-2', subject: '数理化', title: '数理化专项', desc: '挑一个薄弱章节，连做 10 道同类题', min: 40 }
      ];
    }

    var w = isoWeek(date);
    var evenWeek = w.week % 2 === 0;
    return [
      { id: 'sci-review', subject: '数理化', title: '错题复盘', desc: '本周错题重做，只留还没懂的 3 道', min: 40 },
      {
        id: 'cn-essay', subject: '语文', tag: '语文重点',
        title: evenWeek ? '语文作文' : '语文作文提纲',
        desc: evenWeek ? '双周：完整写一篇 800 字作文' : '单周：写三个分论点 + 开头结尾',
        min: 40
      },
      { id: 'cn-material', subject: '语文', tag: '语文重点', title: '素材摘抄', desc: '摘 3 条人物或时事素材，各写一句用法', min: 15 }
    ];
  }

  function doneIds(date) {
    var arr = state.checkins[dateKey(date)];
    return Array.isArray(arr) ? arr : [];
  }

  function metrics(date) {
    var tasks = tasksFor(date);
    var ids = doneIds(date);
    var n = 0;
    tasks.forEach(function (t) { if (ids.indexOf(t.id) >= 0) n++; });
    return {
      tasks: tasks,
      ids: ids,
      done: n,
      total: tasks.length,
      pct: tasks.length ? Math.round((n / tasks.length) * 100) : 0,
      minutes: tasks.reduce(function (s, t) { return s + t.min; }, 0)
    };
  }

  function weekMetrics() {
    var today = new Date();
    var monday = startOfWeek(today);
    var todayKey = dateKey(today);
    var total = 0, done = 0;
    for (var i = 0; i < 7; i++) {
      var d = addDays(monday, i);
      if (dateKey(d) > todayKey) break;
      var m = metrics(d);
      total += m.total;
      done += m.done;
    }
    return { total: total, done: done, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function hasCheckin(date) {
    var arr = state.checkins[dateKey(date)];
    return Array.isArray(arr) && arr.length > 0;
  }

  function currentStreak() {
    var cursor = new Date();
    // 今天还没打卡不算断签，从昨天开始往回数
    if (!hasCheckin(cursor)) cursor = addDays(cursor, -1);
    var n = 0;
    while (hasCheckin(cursor) && n < 3660) {
      n++;
      cursor = addDays(cursor, -1);
    }
    return n;
  }

  function lifetime() {
    var tasks = 0, days = 0;
    Object.keys(state.checkins).forEach(function (k) {
      var arr = state.checkins[k];
      if (Array.isArray(arr) && arr.length) {
        tasks += arr.length;
        days++;
      }
    });
    return { tasks: tasks, days: days };
  }

  /* ---------------- Toast / Modal ---------------- */
  var toastHost = $('#toastHost');
  function toast(msg) {
    if (!toastHost) return;
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    toastHost.appendChild(el);
    var life = reduced() ? 1600 : 2200;
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }, life);
  }

  var modal = $('#confirmModal');
  var modalAction = null;

  function openConfirm(opt) {
    if (!modal) return;
    $('#modalTitle').textContent = opt.title;
    var p = $('.modal-card p', modal);
    if (p) p.textContent = opt.text;
    $('#modalConfirm').textContent = opt.confirmText || '确认';
    modalAction = opt.onConfirm;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    var cancel = $('#modalCancel');
    if (cancel) cancel.focus();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modalAction = null;
    document.body.style.overflow = '';
  }

  /* ---------------- 渲染：任务 ---------------- */
  function taskHTML(t, done) {
    var color = SUBJECT_COLOR[t.subject] || '#3f5a3f';
    return '' +
      '<li class="task' + (done ? ' is-done' : '') + '" data-id="' + t.id + '">' +
        '<button class="task-check" type="button" aria-pressed="' + (done ? 'true' : 'false') + '" aria-label="标记完成：' + esc(t.title) + '">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.4 12 13 4.6"/></svg>' +
        '</button>' +
        '<div class="task-main">' +
          '<div class="task-head">' +
            '<h3 class="task-title">' + esc(t.title) + '</h3>' +
            '<span class="tag tag-subject" style="--sc:' + color + '">' + esc(t.subject) + '</span>' +
            (t.tag ? '<span class="tag tag-key">' + esc(t.tag) + '</span>' : '') +
          '</div>' +
          '<p class="task-desc">' + esc(t.desc) + '</p>' +
        '</div>' +
        '<span class="tag tag-min">' + t.min + ' 分钟</span>' +
      '</li>';
  }

  function renderTaskList(el, date) {
    if (!el) return;
    var m = metrics(date);
    el.dataset.date = dateKey(date);
    el.innerHTML = m.tasks.map(function (t) { return taskHTML(t, m.ids.indexOf(t.id) >= 0); }).join('');
  }

  /* ---------------- 渲染：总览 ---------------- */
  function renderOverview() {
    var m = metrics(new Date());
    var now = new Date();

    $('#heroNote').textContent = '今天 ' + m.total + ' 项任务 · 约 ' + m.minutes + ' 分钟';
    $('#todayMeta').textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 · ' +
      WEEKDAY[now.getDay()] + ' · 共 ' + m.total + ' 项 · 约 ' + m.minutes + ' 分钟';

    var firstNote = $('#firstNote');
    var isFirst = !Object.keys(state.checkins).length && !Object.keys(state.reviews).length;
    firstNote.hidden = !isFirst;
    firstNote.textContent = isFirst
      ? '👋 第一天：计划已经按今天排好了，从最容易的一项开始，打第一个勾就好。'
      : '';

    renderStats();
    renderTaskList($('#overviewTasks'), new Date());
  }

  function renderStats() {
    var grid = $('#statGrid');
    if (!grid) return;
    var today = new Date();
    var m = metrics(today);
    var w = weekMetrics();
    var streak = currentStreak();
    var life = lifetime();
    var todayDone = m.done > 0;

    grid.innerHTML = '' +
      '<article class="stat">' +
        '<div class="stat-label">今日进度</div>' +
        '<div class="stat-value">' + m.pct + '<i>%</i></div>' +
        '<div class="stat-bar"><i data-w="' + m.pct + '"></i></div>' +
        '<div class="stat-foot">' + m.done + ' / ' + m.total + ' 项已完成</div>' +
      '</article>' +
      '<article class="stat">' +
        '<div class="stat-label">连续打卡</div>' +
        '<div class="stat-value">' + streak + '<i>天</i></div>' +
        '<div class="stat-foot">' + (todayDone ? '今天已打卡，继续保持' : '今天还没打卡，先做一项') + '</div>' +
      '</article>' +
      '<article class="stat">' +
        '<div class="stat-label">本周完成率</div>' +
        '<div class="stat-value">' + w.pct + '<i>%</i></div>' +
        '<div class="stat-bar gold"><i data-w="' + w.pct + '"></i></div>' +
        '<div class="stat-foot">周一至今 ' + w.done + ' / ' + w.total + ' 项</div>' +
      '</article>' +
      '<article class="stat">' +
        '<div class="stat-label">累计打卡任务</div>' +
        '<div class="stat-value">' + life.tasks + '<i>项</i></div>' +
        '<div class="stat-foot">共 ' + life.days + ' 天有记录</div>' +
      '</article>';

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        $$('.stat-bar i', grid).forEach(function (bar) {
          bar.style.width = (bar.getAttribute('data-w') || 0) + '%';
        });
      });
    });

    updateSideStreak(streak);
  }

  /* ---------------- 渲染：每日打卡 ---------------- */
  var QUOTES = [
    { text: '把一小时的坚持，交给时间。', from: '知行手记' },
    { text: '进步不是一口气跑完的，是每天多走一小步。', from: '知行手记' },
    { text: '语文的分，藏在每天那十五分钟里。', from: '知行手记' },
    { text: '慢一点，但不要停。', from: '知行手记' },
    { text: '所谓天赋，不过是重复到不再费力。', from: '知行手记' }
  ];

  function renderDaily() {
    var k = dateKey(dailyDate);
    var m = metrics(dailyDate);
    var isToday = k === dateKey(new Date());

    $('#dateLabel').textContent = (dailyDate.getMonth() + 1) + '月' + dailyDate.getDate() + '日 · ' + WEEKDAY[dailyDate.getDay()];
    $('#datePill').classList.toggle('is-today', isToday);
    $('#nextDay').disabled = k >= dateKey(new Date());

    $('#dailyGreeting').textContent = state.nickname
      ? state.nickname + '，今天也把一小时留给自己。'
      : '把今天这一小时，交给计划。';

    $('#ringCaption').textContent = isToday ? '今日进度' : '当日进度';
    renderTaskList($('#dailyTasks'), dailyDate);
    updateDailyMetrics(m, isToday);

    var q = QUOTES[Math.floor((dailyDate - new Date(dailyDate.getFullYear(), 0, 0)) / 86400000) % QUOTES.length] || QUOTES[0];
    $('#quoteText').textContent = q.text;
    $('#quoteFrom').textContent = q.from;
  }

  function updateDailyMetrics(m, isToday) {
    var pct = m.pct;
    if (!isToday) ringShown = 0;
    var offset = RING_C * (1 - pct / 100);
    var ringBar = $('#ringBar');
    if (ringBar) {
      ringBar.style.strokeDasharray = RING_C.toFixed(2);
      ringBar.style.strokeDashoffset = offset.toFixed(2);
    }
    animateNumber($('#ringNum'), ringShown, pct, 620);
    ringShown = pct;

    var left = m.total - m.done;
    $('#remainMin').textContent = String(m.tasks.reduce(function (s, t) {
      return s + (m.ids.indexOf(t.id) >= 0 ? 0 : t.min);
    }, 0));
    $('#doneCount').textContent = String(m.done);
    $('#totalCount').textContent = String(m.total);

    var text;
    if (m.done === 0) text = '还没有开始，先挑最想做的一项。';
    else if (left === 0) text = '今天的 ' + m.total + ' 项都做完了，可以安心合上书。';
    else text = '已经完成 ' + m.done + ' 项，还剩 ' + left + ' 项，慢慢来。';
    $('#dailySummaryText').textContent = text;

    var chips = $('#dailyChips');
    if (chips) {
      chips.innerHTML = m.tasks.map(function (t) {
        var done = m.ids.indexOf(t.id) >= 0;
        return '<span class="chip' + (done ? ' is-done' : '') + '">' + esc(t.title) + '</span>';
      }).join('');
    }
  }

  function animateNumber(el, from, to, dur) {
    if (!el) return;
    if (reduced() || Math.abs(to - from) < 0.5) {
      el.textContent = String(Math.round(to));
      return;
    }
    if (el._raf) cancelAnimationFrame(el._raf);
    var start = performance.now();
    function step(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) el._raf = requestAnimationFrame(step);
    }
    el._raf = requestAnimationFrame(step);
  }

  /* ---------------- 渲染：每周复盘 ---------------- */
  function weekLabel(key) {
    var p = String(key).split('-W');
    return { year: p[0], week: p[1] };
  }

  function renderWeekly(resetFields) {
    var info = isoWeek(new Date());
    $('#weekPill').textContent = '第 ' + info.week + ' 周';

    // 只有切到新的一周时才回填，避免切页面时把没保存的草稿冲掉
    if (resetFields && reviewWeekKey !== info.key) {
      var saved = state.reviews[info.key] || {};
      $('#rv1').value = saved.t1 || '';
      $('#rv2').value = saved.t2 || '';
      $('#rv3').value = saved.t3 || '';
      reviewWeekKey = info.key;
    } else if (!resetFields) {
      reviewWeekKey = info.key;
    }

    var history = $('#reviewHistory');
    var empty = $('#reviewEmpty');
    var keys = Object.keys(state.reviews).filter(function (k) { return /^\d{4}-W\d+$/.test(k); });
    keys.sort(function (a, b) {
      var A = weekLabel(a), B = weekLabel(b);
      return (Number(B.year) * 100 + Number(B.week)) - (Number(A.year) * 100 + Number(A.week));
    });

    if (!keys.length) {
      history.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    history.innerHTML = keys.map(function (k) {
      var w = weekLabel(k);
      var r = state.reviews[k] || {};
      var rows = [['①', r.t1], ['②', r.t2], ['③', r.t3]]
        .filter(function (r2) { return r2[1] && String(r2[1]).trim(); })
        .map(function (r2) {
          return '<p class="history-row"><b>' + r2[0] + '</b><span>' + esc(r2[1]).replace(/\n/g, '<br>') + '</span></p>';
        }).join('');
      return '' +
        '<article class="history-card" data-week="' + k + '">' +
          '<button class="history-del" type="button" data-del="' + k + '" aria-label="删除第 ' + w.week + ' 周复盘">×</button>' +
          '<div class="history-head"><strong>第 ' + w.week + ' 周</strong><span>' + w.year + ' · 保存于 ' + (r.at ? shortTime(r.at) : '—') + '</span></div>' +
          (rows || '<p class="history-row"><span>（这一周只打了勾，没写文字）</span></p>') +
        '</article>';
    }).join('');
  }

  /* ---------------- 渲染：学习计划 ---------------- */
  var GOALS = [
    { id: 'g1', text: '语文单科提升 8 分' },
    { id: 'g2', text: '数学稳定在 110 分以上' },
    { id: 'g3', text: '每周复盘一次不漏' },
    { id: 'g4', text: '月考排名前进 10 名' }
  ];

  function renderPlan() {
    var mk = monthKey(new Date());
    var map = state.goals[mk] || {};
    $('#goalList').innerHTML = GOALS.map(function (g) {
      var on = !!map[g.id];
      return '' +
        '<li class="goal' + (on ? ' is-done' : '') + '" data-goal="' + g.id + '" role="checkbox" tabindex="0" aria-checked="' + on + '">' +
          '<span class="goal-box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.4 12 13 4.6"/></svg></span>' +
          '<span>' + esc(g.text) + '</span>' +
        '</li>';
    }).join('');
    var doneCount = GOALS.filter(function (g) { return map[g.id]; }).length;
    $('#goalHint').textContent = new Date().getMonth() + 1 + '月目标 · 已完成 ' + doneCount + ' / ' + GOALS.length;
  }

  /* ---------------- 渲染：设置 ---------------- */
  function renderSettings() {
    $('#nickname').value = state.nickname || '';
    $('#startDate').value = state.startDate || dateKey(new Date());
    $$('.switch').forEach(function (btn) {
      var key = btn.getAttribute('data-switch');
      btn.setAttribute('aria-checked', state.settings[key] ? 'true' : 'false');
    });
  }

  /* ---------------- 侧边栏 ---------------- */
  function updateSideStreak(streak) {
    var el = $('#sideStreak');
    if (!el) return;
    var val = streak === undefined ? currentStreak() : streak;
    var prev = Number(el.textContent);
    el.textContent = String(val);
    if (prev !== val && !reduced()) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
      el.addEventListener('animationend', function handler() {
        el.classList.remove('bump');
        el.removeEventListener('animationend', handler);
      });
    }
  }

  var nav = $('#nav');
  var indicator = $('#navIndicator');

  function moveIndicator() {
    if (!nav || !indicator) return;
    var active = $('.nav-item.is-active', nav);
    if (!active) { indicator.classList.remove('is-on'); return; }
    var navRect = nav.getBoundingClientRect();
    var r = active.getBoundingClientRect();
    var horizontal = window.matchMedia('(max-width: 900px)').matches;

    if (horizontal) {
      indicator.style.left = (r.left - navRect.left) + 'px';
      indicator.style.top = (r.bottom - navRect.top - 3) + 'px';
      indicator.style.width = r.width + 'px';
      indicator.style.height = '3px';
    } else {
      indicator.style.left = '0px';
      indicator.style.top = (r.top - navRect.top) + 'px';
      indicator.style.width = '3px';
      indicator.style.height = r.height + 'px';
    }
    indicator.classList.add('is-on');
  }

  /* ---------------- 路由 ---------------- */
  function navigate(view) {
    if (VIEWS.indexOf(view) < 0) view = 'overview';
    activeView = view;

    $$('.view').forEach(function (sec) {
      var on = sec.getAttribute('data-view') === view;
      sec.hidden = !on;
      sec.classList.toggle('is-active', on);
    });
    $$('.nav-item').forEach(function (a) {
      var on = a.getAttribute('data-view') === view;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    try { history.replaceState(null, '', '#' + view); } catch (e) { /* file:// 下忽略 */ }

    renderView(view);
    window.scrollTo(0, 0);
    requestAnimationFrame(moveIndicator);
  }

  function renderView(view) {
    if (view === 'overview') renderOverview();
    else if (view === 'daily') renderDaily();
    else if (view === 'weekly') renderWeekly(true);
    else if (view === 'plan') renderPlan();
    else if (view === 'settings') renderSettings();
    updateSideStreak();
  }

  /* ---------------- 交互 ---------------- */
  function toggleTask(li, listEl) {
    var k = listEl.getAttribute('data-date');
    if (!k || !li) return;
    var id = li.getAttribute('data-id');
    var arr = (state.checkins[k] || []).slice();
    var i = arr.indexOf(id);
    var nowDone = i < 0;

    if (nowDone) arr.push(id);
    else arr.splice(i, 1);

    if (arr.length) state.checkins[k] = arr;
    else delete state.checkins[k];
    save();

    li.classList.toggle('is-done', nowDone);
    var btn = $('.task-check', li);
    if (btn) btn.setAttribute('aria-pressed', nowDone ? 'true' : 'false');

    var task = tasksFor(parseKey(k)).filter(function (t) { return t.id === id; })[0];
    toast(nowDone ? '完成「' + (task ? task.title : '任务') + '」，很不错' : '已取消「' + (task ? task.title : '任务') + '」');

    refreshMetrics(k, listEl);
  }

  function refreshMetrics(k, listEl) {
    updateSideStreak();
    var note = $('#firstNote');
    if (note && !Object.keys(state.checkins).length) note.hidden = false;
    else if (note) note.hidden = true;

    if (activeView === 'overview') {
      renderStats();
      return;
    }
    if (activeView === 'daily' && k === dateKey(dailyDate)) {
      updateDailyMetrics(metrics(dailyDate), dateKey(dailyDate) === dateKey(new Date()));
    }
  }

  document.addEventListener('click', function (e) {
    var navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      e.preventDefault();
      navigate(navBtn.getAttribute('data-nav'));
      return;
    }

    var navItem = e.target.closest('.nav-item');
    if (navItem) {
      e.preventDefault();
      navigate(navItem.getAttribute('data-view'));
      return;
    }

    var task = e.target.closest('.task');
    if (task) {
      var list = task.closest('.task-list');
      if (list) { toggleTask(task, list); return; }
    }

    var dayBtn = e.target.closest('[data-day]');
    if (dayBtn) {
      var step = Number(dayBtn.getAttribute('data-day'));
      var next = addDays(dailyDate, step);
      if (dateKey(next) > dateKey(new Date())) { toast('还没到那一天'); return; }
      dailyDate = next;
      renderDaily();
      return;
    }

    var goal = e.target.closest('.goal');
    if (goal) {
      toggleGoal(goal);
      return;
    }

    var del = e.target.closest('[data-del]');
    if (del) {
      deleteReview(del.getAttribute('data-del'));
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal && !modal.hidden) { closeModal(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('goal')) {
      e.preventDefault();
      toggleGoal(e.target);
    }
  });

  function toggleGoal(goal) {
    var mk = monthKey(new Date());
    var id = goal.getAttribute('data-goal');
    var map = state.goals[mk] ? Object.assign({}, state.goals[mk]) : {};
    var on = !map[id];
    if (on) map[id] = true; else delete map[id];
    if (Object.keys(map).length) state.goals[mk] = map;
    else delete state.goals[mk];
    save();

    goal.classList.toggle('is-done', on);
    goal.setAttribute('aria-checked', on ? 'true' : 'false');
    var doneCount = $$('.goal.is-done').length;
    $('#goalHint').textContent = new Date().getMonth() + 1 + '月目标 · 已完成 ' + doneCount + ' / ' + GOALS.length;
    toast(on ? '这个月又近了一点' : '已取消这个目标');
  }

  var datePill = $('#datePill');
  if (datePill) {
    datePill.addEventListener('click', function () {
      if (dateKey(dailyDate) === dateKey(new Date())) { toast('已经是今天了'); return; }
      dailyDate = new Date();
      renderDaily();
      toast('回到今天');
    });
  }

  var saveReviewBtn = $('#saveReview');
  if (saveReviewBtn) {
    saveReviewBtn.addEventListener('click', function () {
      var t1 = $('#rv1').value.trim();
      var t2 = $('#rv2').value.trim();
      var t3 = $('#rv3').value.trim();
      if (!t1 && !t2 && !t3) {
        toast('先写一句，再保存');
        $('#rv1').focus();
        return;
      }
      var info = isoWeek(new Date());
      state.reviews[info.key] = { t1: t1, t2: t2, t3: t3, at: Date.now() };
      save();
      renderWeekly(false);
      toast('第 ' + info.week + ' 周复盘已保存');
    });
  }

  function deleteReview(key) {
    var w = weekLabel(key);
    openConfirm({
      title: '删除第 ' + w.week + ' 周的复盘？',
      text: '这段文字会被永久删除，且无法恢复。',
      confirmText: '删除',
      onConfirm: function () {
        delete state.reviews[key];
        save();
        reviewWeekKey = null;
        renderWeekly(true);
        toast('已删除第 ' + w.week + ' 周的复盘');
      }
    });
  }

  $$('.switch').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-switch');
      var next = !state.settings[key];
      state.settings[key] = next;
      save();
      btn.setAttribute('aria-checked', next ? 'true' : 'false');
      toast((next ? '已开启' : '已关闭') + (key === 'dailyReminder' ? '每日打卡提醒' : '周末整块学习提醒'));
    });
  });

  var nicknameEl = $('#nickname');
  if (nicknameEl) {
    var nickTimer = null;
    nicknameEl.addEventListener('input', function () {
      state.nickname = nicknameEl.value.slice(0, 12);
      clearTimeout(nickTimer);
      nickTimer = setTimeout(save, 400);
    });
    nicknameEl.addEventListener('change', function () {
      state.nickname = nicknameEl.value.trim().slice(0, 12);
      save();
      toast(state.nickname ? '你好，' + state.nickname : '昵称已清空');
    });
  }

  var startDateEl = $('#startDate');
  if (startDateEl) {
    startDateEl.addEventListener('change', function () {
      if (!startDateEl.value) return;
      state.startDate = startDateEl.value;
      save();
      toast('使用日期已更新');
    });
  }

  var clearBtn = $('#clearData');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      openConfirm({
        title: '确定清空所有数据？',
        text: '打卡记录、每周复盘和月度目标都会被删除，且无法恢复。',
        confirmText: '确认清空',
        onConfirm: function () {
          state = defaultState();
          try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
          save();
          dailyDate = new Date();
          reviewWeekKey = null;
          renderView(activeView);
          toast('已清空，重新开始');
        }
      });
    });
  }

  var modalCancel = $('#modalCancel');
  var modalConfirm = $('#modalConfirm');
  if (modalCancel) modalCancel.addEventListener('click', closeModal);
  if (modalConfirm) {
    modalConfirm.addEventListener('click', function () {
      var fn = modalAction;
      closeModal();
      if (typeof fn === 'function') fn();
    });
  }
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
  }

  var feedbackBtn = $('#feedbackBtn');
  if (feedbackBtn) {
    feedbackBtn.addEventListener('click', function () {
      toast('反馈请发到 hello@zhixing.study');
      window.setTimeout(function () {
        try { window.location.href = 'mailto:hello@zhixing.study?subject=' + encodeURIComponent('知行 · 使用反馈'); }
        catch (err) { /* ignore */ }
      }, 700);
    });
  }

  /* ---------------- 尺寸变化 ---------------- */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(moveIndicator, 120);
  });
  if (nav) nav.addEventListener('scroll', function () { moveIndicator(); }, { passive: true });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { moveIndicator(); });
  }
  if (mqReduce.addEventListener) {
    mqReduce.addEventListener('change', moveIndicator);
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    var hash = (location.hash || '').replace('#', '');
    var start = VIEWS.indexOf(hash) >= 0 ? hash : 'overview';

    dailyDate = new Date();
    navigate(start);

    // 首屏加载后校准指示条与入场动画
    setTimeout(moveIndicator, 60);
    setTimeout(moveIndicator, 460);
    setTimeout(function () { updateSideStreak(); }, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
