/* ============================================================
   知行 · 月考后学习提升计划
   原生 JS · localStorage 持久化
   ============================================================ */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  var KEY = 'zhixing.study.plan.v1';
  var VIEWS = ['overview', 'daily', 'weekly', 'plan', 'tools', 'mistakes', 'quotes', 'favorites', 'settings'];
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
      checkinAt: {},
      reviews: {},
      goals: {},
      mistakes: [],
      quoteNotes: {},
      favorites: [],
      favAt: 0,
      mkTrash: [],
      updatedAt: 0,
      resetAt: 0
    };
  }

  // 把任意来源（本机 localStorage / 云端 jsonb）整理成当前版本的结构
  function normalizeState(p) {
    var base = defaultState();
    if (!p || typeof p !== 'object') return base;
    return {
      nickname: typeof p.nickname === 'string' ? p.nickname : '',
      startDate: p.startDate || base.startDate,
      settings: Object.assign({}, base.settings, p.settings || {}),
      checkins: p.checkins && typeof p.checkins === 'object' ? p.checkins : {},
      checkinAt: p.checkinAt && typeof p.checkinAt === 'object' ? p.checkinAt : {},
      reviews: p.reviews && typeof p.reviews === 'object' ? p.reviews : {},
      goals: p.goals && typeof p.goals === 'object' ? p.goals : {},
      mistakes: Array.isArray(p.mistakes) ? p.mistakes.filter(function (m) {
        return m && typeof m === 'object' && typeof m.title === 'string' && m.title.trim();
      }).slice(0, 500).map(function (m) {
        var at = typeof m.at === 'number' && isFinite(m.at) ? m.at : Date.now();
        return {
          id: typeof m.id === 'string' && m.id ? m.id : 'mk-' + Math.random().toString(36).slice(2, 9),
          subject: SUBJECT_COLOR[m.subject] ? m.subject : '语文',
          title: String(m.title).slice(0, 120),
          reason: typeof m.reason === 'string' ? m.reason.slice(0, 400) : '',
          done: !!m.done,
          at: at,
          upd: typeof m.upd === 'number' && isFinite(m.upd) ? m.upd : at
        };
      }) : [],
      quoteNotes: p.quoteNotes && typeof p.quoteNotes === 'object' ? p.quoteNotes : {},
      favorites: Array.isArray(p.favorites) ? p.favorites.filter(function (t) { return typeof t === 'string'; }) : [],
      favAt: typeof p.favAt === 'number' && isFinite(p.favAt) ? p.favAt : 0,
      mkTrash: Array.isArray(p.mkTrash) ? p.mkTrash.filter(function (t) { return typeof t === 'string'; }) : [],
      updatedAt: typeof p.updatedAt === 'number' && isFinite(p.updatedAt) ? p.updatedAt : 0,
      resetAt: typeof p.resetAt === 'number' && isFinite(p.resetAt) ? p.resetAt : 0
    };
  }

  var state = loadState();
  var dailyDate = new Date();
  var activeView = 'overview';
  var ringShown = 0;
  var storageWarned = false;
  var reviewWeekKey = null;

  function loadState() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function saveLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        toast('浏览器禁止本地存储，本次修改无法保存');
      }
    }
  }

  // 所有改动都走这里：先落本机，再排队推云端（未登录时 push 是空操作）
  function save() {
    state.updatedAt = Date.now();
    saveLocal();
    scheduleCloudPush();
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
    { note: '进步是慢慢攒出来的，今天的一小步，终会连成千里。', text: '把一小时的坚持，交给时间。', from: '知行手记' },
    { note: '求索的路很长，但每走一步都算数。', text: '进步不是一口气跑完的，是每天多走一小步。', from: '知行手记' },
    { note: '相信会有乘风破浪的那天，先别停下桨。', text: '语文的分，藏在每天那十五分钟里。', from: '知行手记' },
    { note: '好东西都是磨出来的，别怕当下的辛苦。', text: '慢一点，但不要停。', from: '知行手记' },
    { note: '精与荒、成与毁，差的就是那点坚持。', text: '所谓天赋，不过是重复到不再费力。', from: '知行手记' }
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
      var savedRaw = state.reviews[info.key];
      var saved = (savedRaw && !savedRaw.del) ? savedRaw : {};
      $('#rv1').value = saved.t1 || '';
      $('#rv2').value = saved.t2 || '';
      $('#rv3').value = saved.t3 || '';
      reviewWeekKey = info.key;
    } else if (!resetFields) {
      reviewWeekKey = info.key;
    }

    var history = $('#reviewHistory');
    var empty = $('#reviewEmpty');
    var keys = Object.keys(state.reviews).filter(function (k) {
      return /^\d{4}-W\d+$/.test(k) && !(state.reviews[k] && state.reviews[k].del);
    });
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

  /* ---------------- 渲染：错题本 ---------------- */
  var mkSubject = '语文';
  var mkFilter = 'all';

  function mkSorted() {
    return (state.mistakes || []).slice().sort(function (a, b) { return b.at - a.at; });
  }

  function mkItemHTML(m) {
    var color = SUBJECT_COLOR[m.subject] || '#3f5a3f';
    var label = (m.done ? '撤销弄懂：' : '标记已弄懂：') + m.title;
    return '' +
      '<li class="mk-item' + (m.done ? ' is-done' : '') + '" data-id="' + esc(m.id) + '" style="--mk:' + color + '">' +
        '<button class="mk-check" type="button" aria-pressed="' + (m.done ? 'true' : 'false') + '" aria-label="' + esc(label) + '">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5 6.4 12 13 4.6"/></svg>' +
        '</button>' +
        '<div class="mk-body">' +
          '<div class="mk-head">' +
            '<span class="tag tag-subject" style="--sc:' + color + '">' + esc(m.subject) + '</span>' +
            '<h3 class="mk-title">' + esc(m.title) + '</h3>' +
          '</div>' +
          (m.reason ? '<p class="mk-reason">' + esc(m.reason) + '</p>' : '') +
          '<p class="mk-meta"><span class="mk-state">' + (m.done ? '已弄懂' : '待弄懂') + '</span>' +
            '<span class="mk-dot" aria-hidden="true">·</span>记录于 ' + shortTime(m.at) + '</p>' +
        '</div>' +
        '<button class="mk-del" type="button" data-del-mk="' + esc(m.id) + '" aria-label="删除这道错题">×</button>' +
      '</li>';
  }

  function renderMistakes() {
    var all = mkSorted();
    var open = all.filter(function (m) { return !m.done; }).length;

    var countEl = $('#mkCount');
    if (countEl) countEl.textContent = '待弄懂 ' + open + ' 道';

    var statEl = $('#mkStat');
    if (statEl) statEl.textContent = all.length
      ? '共 ' + all.length + ' 道 · 已弄懂 ' + (all.length - open) + ' 道'
      : '';

    var shown = all.filter(function (m) {
      if (mkFilter === 'open') return !m.done;
      if (mkFilter === 'done') return m.done;
      return true;
    });

    var list = $('#mkList');
    if (list) list.innerHTML = shown.map(mkItemHTML).join('');

    var empty = $('#mkEmpty');
    if (empty) {
      empty.hidden = shown.length > 0;
      empty.textContent = all.length
        ? '这个筛选下还没有错题，换个条件看看。'
        : '还没有错题。今天做错的题，挑一道记下来，比再刷十道有用。';
    }

    $$('#mkFilters .unit-chip').forEach(function (b) {
      var on = b.getAttribute('data-filter') === mkFilter;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $$('#mkSubjects .unit-chip').forEach(function (b) {
      var on = b.getAttribute('data-subject') === mkSubject;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function addMistake() {
    var titleEl = $('#mkTitle');
    if (!titleEl) return;
    var reasonEl = $('#mkReason');
    var title = titleEl.value.trim();
    if (!title) {
      toast('先写一句题目或考点');
      titleEl.focus();
      return;
    }
    if (!Array.isArray(state.mistakes)) state.mistakes = [];
    state.mistakes.push({
      id: 'mk-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      subject: SUBJECT_COLOR[mkSubject] ? mkSubject : '语文',
      title: title.slice(0, 120),
      reason: reasonEl ? reasonEl.value.trim().slice(0, 400) : '',
      done: false,
      at: Date.now(),
      upd: Date.now()
    });
    save();
    titleEl.value = '';
    if (reasonEl) reasonEl.value = '';
    mkFilter = 'all';
    renderMistakes();
    toast('已加入错题本，共 ' + state.mistakes.length + ' 道');
    titleEl.focus();
  }

  function toggleMistake(id) {
    var m = (state.mistakes || []).filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    m.done = !m.done;
    m.upd = Date.now();
    save();
    renderMistakes();
    toast(m.done ? '已标记弄懂，可以移出清单了' : '已改回待弄懂');
  }

  function deleteMistake(id) {
    var before = (state.mistakes || []).length;
    state.mistakes = (state.mistakes || []).filter(function (x) { return x.id !== id; });
    if (state.mistakes.length === before) return;
    // 记进回收名单，避免另一台设备的旧数据把它带回来
    if (!Array.isArray(state.mkTrash)) state.mkTrash = [];
    if (state.mkTrash.indexOf(id) < 0) state.mkTrash.push(id);
    save();
    renderMistakes();
    toast('已删除这道错题');
  }

  /* ---------------- 渲染：每日名句 ---------------- */
  var FAMOUS_QUOTES = [
    { note: '看懂和做到之间，还差一次亲自动手。', text: '不积跬步，无以至千里；不积小流，无以成江海。', from: '荀子《劝学》' },
    { note: '少年时多用的功，老了不会辜负你。', text: '路漫漫其修远兮，吾将上下而求索。', from: '屈原《离骚》' },
    { note: '现在偷的懒，以后都要补回来。', text: '长风破浪会有时，直挂云帆济沧海。', from: '李白《行路难》' },
    { note: '先广博地看，再慢慢地取，厚积才能薄发。', text: '宝剑锋从磨砺出，梅花香自苦寒来。', from: '《警世贤文》' },
    { note: '心静得下来，才看得清自己要去哪。', text: '业精于勤，荒于嬉；行成于思，毁于随。', from: '韩愈《进学解》' },
    { note: '熬过辛苦，沙里才能淘出金子。', text: '纸上得来终觉浅，绝知此事要躬行。', from: '陆游《冬夜读书示子聿》' },
    { note: '做得多了，自然就懂了门道。', text: '三更灯火五更鸡，正是男儿读书时。', from: '颜真卿《劝学》' },
    { note: '心要常新，得像活水一样不断补进东西。', text: '黑发不知勤学早，白首方悔读书迟。', from: '颜真卿《劝学》' },
    { note: '时间不等人，最经不起浪费的就是光阴。', text: '博观而约取，厚积而薄发。', from: '苏轼《稼说送张琥》' },
    { note: '能不能成，往往就看能不能再多坚持一下。', text: '非淡泊无以明志，非宁静无以致远。', from: '诸葛亮《诫子书》' },
    { note: '站得高一点，眼前的难就小一点。', text: '千淘万漉虽辛苦，吹尽狂沙始到金。', from: '刘禹锡《浪淘沙》' },
    { note: '读得够多，写和说都会顺起来。', text: '操千曲而后晓声，观千剑而后识器。', from: '刘勰《文心雕龙》' },
    { note: '好书值得反复读，每读一遍都有新东西。', text: '问渠那得清如许？为有源头活水来。', from: '朱熹《观书有感》' },
    { note: '别等头发白了才后悔当初没用力。', text: '少年易老学难成，一寸光阴不可轻。', from: '朱熹《偶成》' },
    { note: '成大事，光有才不够，还得有股韧劲。', text: '锲而舍之，朽木不折；锲而不舍，金石可镂。', from: '荀子《劝学》' },
    { note: '读书先学做人，下苦功才有真本事。', text: '会当凌绝顶，一览众山小。', from: '杜甫《望岳》' },
    { note: '不往前，就往后，学习没有原地踏步。', text: '读书破万卷，下笔如有神。', from: '杜甫《奉赠韦左丞丈二十二韵》' },
    { note: '学、问、思、辨、行，五件事一个都不能少。', text: '旧书不厌百回读，熟读深思子自知。', from: '苏轼《送安惇秀才失解西归》' },
    { note: '人不学不成器，打磨自己的过程虽然疼，但必要。', text: '莫等闲，白了少年头，空悲切。', from: '岳飞《满江红》' },
    { note: '聪明又好学，还肯向不如自己的人请教，最难得。', text: '古之立大事者，不惟有超世之才，亦必有坚忍不拔之志。', from: '苏轼《晁错论》' },
    { note: '光学不想是迷糊，光想不学是危险。', text: '立志宜思真品格，读书须尽苦功夫。', from: '阮元' },
    { note: '把旧知识再看一遍，常有新发现。', text: '学如逆水行舟，不进则退。', from: '《增广贤文》' },
    { note: '喜欢不如热爱，热爱才走得最远。', text: '博学之，审问之，慎思之，明辨之，笃行之。', from: '《中庸》' },
    { note: '身边谁都有可学的地方，别端着。', text: '玉不琢，不成器；人不学，不知道。', from: '《礼记·学记》' },
    { note: '勤是唯一的捷径，苦是必经的路。', text: '敏而好学，不耻下问。', from: '《论语》' },
    { note: '真读进去了，连春天过去都没察觉。', text: '学而不思则罔，思而不学则殆。', from: '《论语》' },
    { note: '年轻时下功夫，是一辈子的事。', text: '温故而知新，可以为师矣。', from: '《论语》' },
    { note: '好书像老朋友，喜怒哀乐都在身边。', text: '知之者不如好之者，好之者不如乐之者。', from: '《论语》' },
    { note: '用的时候才恨读得少，别等那天。', text: '三人行，必有我师焉。', from: '《论语》' },
    { note: '给自己一点风，也敢往高处去。', text: '书山有路勤为径，学海无涯苦作舟。', from: '韩愈（集句）' },
    { note: '志向不坚定，聪明也白搭；说话不守信，做事难成。', text: '读书不觉已春深，一寸光阴一寸金。', from: '王贞白《白鹿洞》' },
    { note: '再大的东西，也从一点点开始。', text: '少年辛苦终身事，莫向光阴惰寸功。', from: '杜荀鹤《题弟侄书堂》' },
    { note: '哪有什么天才，不过是把别人玩的时间用在正事上。', text: '书卷多情似故人，晨昏忧乐每相亲。', from: '于谦《观书》' },
    { note: '路是走出来的，你走了，后来的人就有路了。', text: '书到用时方恨少，事非经过不知难。', from: '《增广贤文》' },
    { note: '不是没时间，是没去挤。', text: '大鹏一日同风起，扶摇直上九万里。', from: '李白《上李邕》' },
    { note: '别被周围冷却了，自己往上走就好。', text: '志不强者智不达，言不信者行不果。', from: '《墨子》' },
    { note: '聪明人更该下笨功夫，别耍小聪明。', text: '合抱之木，生于毫末；九层之台，起于累土。', from: '《老子》' }
  ,
    { note: '别人的热闹是别人的，守住自己的安静。', text: '哪里有天才，我是把别人喝咖啡的工夫都用在工作上了。', from: '鲁迅' },
    { note: '想得再多，不如先读两页书。', text: '其实地上本没有路，走的人多了，也便成了路。', from: '鲁迅' },
    { note: '经历多了才懂，最珍贵的原来是内心的安稳。', text: '时间就像海绵里的水，只要愿挤，总还是有的。', from: '鲁迅' },
    { note: '别嫌进步小，往前挪一寸就有一寸的欢喜。', text: '愿中国青年都摆脱冷气，只是向上走。', from: '鲁迅' },
    { note: '敢想，也要肯去一点点求证。', text: '越是聪明人，越要懂得下笨功夫。', from: '钱钟书' },
    { note: '担得起责任，才尝得到其中的踏实。', text: '窗外的繁华不是我的繁华。', from: '钱钟书' },
    { note: '成大事业，都要熬过那几重孤独的关口。', text: '你的问题主要在于读书不多而想得太多。', from: '杨绛' },
    { note: '心定，就不容易被外物牵着走。', text: '我们曾如此渴望命运的波澜，到最后才发现，人生最曼妙的风景，竟是内心的淡定与从容。', from: '杨绛' },
    { note: '光鲜背后，都是没人看见的泪和汗。', text: '怕什么真理无穷，进一寸有一寸的欢喜。', from: '胡适' },
    { note: '读书读出的，是一种从容的气质。', text: '大胆地假设，小心地求证。', from: '胡适' },
    { note: '真懂了，自然会去做；做了，才叫真懂。', text: '人生须知负责任的苦处，才能知道尽责任的乐趣。', from: '梁启超' },
    { note: '读书人心里，得装着比自己更大的事。', text: '古今之成大事业、大学问者，必经过三种之境界。', from: '王国维' },
    { note: '真话可以不全说，但假的绝不说，这是底线。', text: '不乱于心，不困于情，不畏将来，不念过往。', from: '丰子恺' },
    { note: '一天里，读书、做人、做事要一起长。', text: '成功的花，人们只惊羡她现时的明艳！然而当初她的芽儿，浸透了奋斗的泪泉。', from: '冰心' },
    { note: '思想独立、精神自由，是最要紧的。', text: '读书使人得到一种优雅和风味。', from: '林语堂' },
    { note: '说得漂亮不如做得漂亮。', text: '知之真切笃实处即是行，行之明觉精察处即是知。', from: '王阳明' },
    { note: '慢一点没关系，别停就好。', text: '为天地立心，为生民立命，为往圣继绝学，为万世开太平。', from: '张载' },
    { note: '摔了七次，第八次还爬起来。', text: '假话全不说，真话不全说。', from: '季羡林' },
    { note: '开始，就是最难也最关键的一步。', text: '一天之内，须于读书、做人、做事三者兼顾。', from: '钱穆' },
    { note: '优秀不是一次表现，是日复一日。', text: '独立之精神，自由之思想。', from: '陈寅恪' },
    { note: '你重复做什么，你就成为什么。', text: 'Well done is better than well said.', from: 'Benjamin Franklin' },
    { note: '每个高手，都曾是啥也不会的新手。', text: 'It does not matter how slowly you go as long as you do not stop.', from: 'Confucius' },
    { note: '敢做梦，也敢搞砸，才有真成长。', text: 'Fall seven times, stand up eight.', from: 'Japanese proverb' },
    { note: '别光想成功，先想想自己能给别人什么。', text: 'The secret of getting ahead is getting started.', from: 'Mark Twain' },
    { note: '大成果，都是小努力一天天堆出来的。', text: 'Quality is not an act, it is a habit.', from: 'Aristotle' },
    { note: '用你手头有的，做你能做的。', text: 'We are what we repeatedly do.', from: 'Aristotle' },
    { note: '学东西不会累坏脑子，尽管去学。', text: 'The expert in anything was once a beginner.', from: '佚名' },
    { note: '教育，是能改变世界的东西。', text: 'Dream big and dare to fail.', from: 'Norman Vaughan' },
    { note: '学到的东西，谁也抢不走。', text: 'Strive not to be a success, but rather to be of value.', from: 'Albert Einstein' },
    { note: '像明天就走那样去活，像永远活着那样去学。', text: 'Success is the sum of small efforts repeated day in and day out.', from: 'Robert Collier' },
    { note: '知识，就是力量。', text: 'Do what you can, with what you have, where you are.', from: 'Theodore Roosevelt' },
    { note: '87 岁了还在学，你我也别停。', text: 'Learning never exhausts the mind.', from: 'Leonardo da Vinci' },
    { note: '值得去的地方，都没有捷径。', text: 'Education is the most powerful weapon which you can use to change the world.', from: 'Nelson Mandela' },
    { note: '每天一小步，久了就是大变化。', text: 'The beautiful thing about learning is that no one can take it away from you.', from: 'B.B. King' },
    { note: '自律，是目标和达成之间的桥。', text: 'Live as if you were to die tomorrow. Learn as if you were to live forever.', from: 'Gandhi' },
    { note: '动力让你开始，习惯让你坚持。', text: 'Knowledge is power.', from: 'Francis Bacon' },
    { note: '不必一开始就厉害，先开始才能变厉害。', text: 'I am still learning.', from: 'Michelangelo' },
    { note: '越努力，达成时越踏实。', text: 'There are no shortcuts to any place worth going.', from: '佚名' },
    { note: '没人替你逼自己，只能自己来。', text: 'Small steps every day lead to big changes.', from: '佚名' },
    { note: '好东西，都不在舒服区里。', text: 'Discipline is the bridge between goals and accomplishment.', from: 'Jim Rohn' },
    { note: '没做成前都像不可能，做完了就平常了。', text: 'Motivation gets you started. Habit keeps you going.', from: '佚名' },
    { note: '相信自己行，就已经成功一半。', text: 'You don’t have to be great to start, but you have to start to be great.', from: '佚名' },
    { note: '别盯着钟，学钟那样一直走。', text: 'The harder you work for something, the greater you’ll feel when you achieve it.', from: '佚名' },
    { note: '一年后你会庆幸今天开始了。', text: 'Push yourself, because no one else is going to do it for you.', from: '佚名' },
    { note: '未来，藏在你今天的行动里。', text: 'Great things never come from comfort zones.', from: '佚名' },
    { note: '默默努力，让结果替你说话。', text: 'It always seems impossible until it’s done.', from: 'Nelson Mandela' },
    { note: '保持饥饿，保持天真。', text: 'Believe you can and you’re halfway there.', from: 'Theodore Roosevelt' },
    { note: '限制你的，往往只是你的想象。', text: 'Don’t watch the clock; do what it does. Keep going.', from: 'Sam Levenson' },
    { note: '想、愿、做，三步走起来。', text: 'A year from now you may wish you had started today.', from: 'Karen Lamb' },
    { note: '要的是有产出，不是瞎忙。', text: 'The future depends on what you do today.', from: 'Gandhi' },
    { note: '一点一点，也能走很远。', text: 'Work hard in silence; let success make the noise.', from: '佚名' },
    { note: '成败靠的不是聪明，是持续的努力。', text: 'Stay hungry, stay foolish.', from: 'Steve Jobs' },
    { note: '压力下的从容，就是勇气。', text: 'Your limitation—it’s only your imagination.', from: '佚名' },
    { note: '天才，九十九分是汗水。', text: 'Dream it. Wish it. Do it.', from: '佚名' },
    { note: '学得开心，就忘不掉。', text: 'Focus on being productive instead of busy.', from: '佚名' },
    { note: '投资知识，回报最好。', text: 'Little by little, one travels far.', from: 'J.R.R. Tolkien' },
    { note: '读书对脑子，就像运动对身体。', text: 'Continuous effort—not strength or intelligence—is the key to unlocking our potential.', from: 'Winston Churchill' },
    { note: '读得越多，知道得越多。', text: 'Courage is grace under pressure.', from: 'Ernest Hemingway' },
    { note: '今天爱读书，明天能领头。', text: 'Genius is one percent inspiration and ninety-nine percent perspiration.', from: 'Thomas Edison' },
    { note: '读书的人，活过很多种人生。', text: 'What we learn with pleasure we never forget.', from: 'Alfred Mercier' },
    { note: '好奇，是智慧的开头。', text: 'An investment in knowledge pays the best interest.', from: 'Benjamin Franklin' },
    { note: '知道自己无知，才是最真的智慧。', text: 'Reading is to the mind what exercise is to the body.', from: 'Joseph Addison' },
    { note: '把伤痕变成智慧。', text: 'The more that you read, the more things you will know.', from: 'Dr. Seuss' },
    { note: '敢问，最多傻五分钟；不问，傻一辈子。', text: 'Today a reader, tomorrow a leader.', from: 'Margaret Fuller' },
    { note: '行动，是成功最底下的那块砖。', text: 'A reader lives a thousand lives before he dies.', from: 'George R.R. Martin' },
    { note: '别数日子，让每一天都算数。', text: 'Wisdom begins in wonder.', from: 'Socrates' },
    { note: '不投，命中率永远是零。', text: 'The only true wisdom is in knowing you know nothing.', from: 'Socrates' },
    { note: '天才不努力，也会被努力的人超过。', text: 'Turn your wounds into wisdom.', from: 'Oprah Winfrey' },
    { note: '成功不是碰巧，是苦出来的。', text: 'He who asks a question is a fool for five minutes; he who does not ask remains a fool forever.', from: 'Chinese proverb' },
    { note: '一次次跌倒，才换来最后站上领奖台。', text: 'Action is the foundational key to all success.', from: 'Pablo Picasso' },
    { note: '站在前人肩上，才看得更远，别忘了感恩来路。', text: 'Don’t count the days; make the days count.', from: 'Muhammad Ali' },
    { note: '知识有边，想象力没有。', text: 'You miss 100% of the shots you don’t take.', from: 'Wayne Gretzky' },
    { note: '别停下去问为什么，那是进步的根。', text: 'Hard work beats talent when talent doesn’t work hard.', from: '佚名' },
    { note: '别怕未知，去弄懂它就好了。', text: 'Success is no accident. It is hard work, perseverance, learning, studying, sacrifice.', from: 'Pelé' },
    { note: '活下来的不是最强最聪明，是最能适应变化的。', text: 'I’ve failed over and over and over again in my life. And that is why I succeed.', from: 'Michael Jordan' }
,
    { note: '真理摆在那，任谁也压不住。', text: 'If I have seen further it is by standing on the shoulders of Giants.', from: 'Isaac Newton' },
    { note: '宇宙里还有无数奇妙，等着被发现。', text: 'Imagination is more important than knowledge.', from: 'Albert Einstein' },
    { note: '说法越惊人，越要惊人地求证。', text: 'The important thing is not to stop questioning.', from: 'Albert Einstein' },
    { note: '别骗自己，你才是最好骗的那个人。', text: 'Nothing in life is to be feared, it is only to be understood.', from: 'Marie Curie' },
    { note: '为长远去干，未来会记得你。', text: 'It is not the strongest of the species that survives, but the one most responsive to change.', from: 'Charles Darwin' },
    { note: '聪明，就是能随变化调整自己。', text: 'And yet it moves.', from: 'Galileo Galilei' },
    { note: '科学不是高高在上，就在日子里。', text: 'Somewhere, something incredible is waiting to be known.', from: 'Carl Sagan' },
    { note: '脑子里的东西，比肉身更长久。', text: 'Extraordinary claims require extraordinary evidence.', from: 'Carl Sagan' },
    { note: '你做的事有意义，关键是你想造哪种意义。', text: 'The first principle is that you must not fool yourself—and you are the easiest person to fool.', from: 'Richard Feynman' },
    { note: '眼前虽近，够我们忙好一阵了。', text: 'The present is theirs; the future, for which I really worked, is mine.', from: 'Nikola Tesla' },
    { note: '活不活、怎么活，是每个人自己的问号。', text: 'Intelligence is the ability to adapt to change.', from: 'Stephen Hawking' },
    { note: '人生如戏，你也是其中一个角色。', text: 'Science and everyday life cannot and should not be separated.', from: 'Rosalind Franklin' },
    { note: '最先要对得起的，是你自己。', text: 'That brain of mine is something more than merely mortal, as time will show.', from: 'Ada Lovelace' },
    { note: '开篇这句讽刺，道尽人情世故。', text: 'What you do makes a difference, and you have to decide what kind of difference you want to make.', from: 'Jane Goodall' },
    { note: '最好和最坏，常在同一时刻。', text: 'We can only see a short distance ahead, but we can see plenty there that needs to be done.', from: 'Alan Turing' },
    { note: '幸福大同小异，不幸各有各的不幸。', text: 'To be, or not to be: that is the question.', from: 'William Shakespeare' },
    { note: '人总想逆流回过去，却只能被冲着往前。', text: 'All the world’s a stage, and all the men and women merely players.', from: 'William Shakespeare' },
    { note: '世界会打碎每个人，有人却在被打碎处长出力量。', text: 'This above all: to thine own self be true.', from: 'William Shakespeare' },
    { note: '谁能改写过去，谁就握着未来。', text: 'It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife.', from: 'Jane Austen' },
    { note: '定义你的，是选择，不是天赋。', text: 'It was the best of times, it was the worst of times.', from: 'Charles Dickens' },
    { note: '迷路的人，未必真迷路。', text: 'Happy families are all alike; every unhappy family is unhappy in its own way.', from: 'Leo Tolstoy' },
    { note: '再长的夜，太阳也会回来。', text: 'So we beat on, boats against the current, borne back ceaselessly into the past.', from: 'F. Scott Fitzgerald' },
    { note: '我不是笼中鸟，谁也网不住我。', text: 'The world breaks everyone, and afterward many are strong at the broken places.', from: 'Ernest Hemingway' },
    { note: '都躺在泥里，有人却抬头看星。', text: 'Who controls the past controls the future. Who controls the present controls the past.', from: 'George Orwell' },
    { note: '说的话做的事会被忘，给人的感觉不会。', text: 'It is our choices, Harry, that show what we truly are, far more than our abilities.', from: 'J.K. Rowling' },
    { note: '迷路的人，未必真迷路。', text: 'Not all those who wander are lost.', from: 'J.R.R. Tolkien' },
    { note: '再长的夜，太阳也会回来。', text: 'Even the darkest night will end and the sun will rise.', from: 'Victor Hugo' },
    { note: '我不是笼中鸟，谁也网不住我。', text: 'I am no bird; and no net ensnares me.', from: 'Charlotte Brontë' },
    { note: '都躺在泥里，有人却抬头看星。', text: 'We are all in the gutter, but some of us are looking at the stars.', from: 'Oscar Wilde' },
    { note: '说的话做的事会被忘，给人的感觉不会。', text: 'People will forget what you said, people will forget what you did, but people will never forget how you made them feel.', from: 'Maya Angelou' }
];

  var quoteIndex = null;
  var quoteDayKey = null;
  var quoteDeck = [];   // 打乱后的「待抽」序号队列
  var quotePos = -1;    // 当前抽到队列的位置
  var currentQuoteText = '';  // 当前展示名句的正文（用作存储键）

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // 生成一张不含 exclude 的乱序牌堆
  function buildDeck(exclude) {
    var pool = [];
    for (var i = 0; i < FAMOUS_QUOTES.length; i++) if (i !== exclude) pool.push(i);
    return shuffle(pool);
  }

  function dailyQuoteIndex() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    var doy = Math.floor((now - start) / 86400000);
    return doy % FAMOUS_QUOTES.length;
  }

  function renderQuotes() {
    var today = new Date();
    var tk = dateKey(today);
    if (quoteDayKey !== tk) {
      quoteDayKey = tk;
      quoteIndex = dailyQuoteIndex();
      quoteDeck = buildDeck(quoteIndex);
      quotePos = -1;
    }
    if (quoteIndex == null || quoteIndex < 0 || quoteIndex >= FAMOUS_QUOTES.length) {
      quoteIndex = dailyQuoteIndex();
    }

    var dateEl = $('#quoteDate');
    if (dateEl) dateEl.textContent = (today.getMonth() + 1) + '月' + today.getDate() + '日';
    var q = FAMOUS_QUOTES[quoteIndex];
    var textEl = $('#quoteBigText');
    var fromEl = $('#quoteBigFrom');
    if (textEl) textEl.textContent = q.text;
    if (fromEl) fromEl.textContent = '—— ' + q.from;
    currentQuoteText = q.text;
    renderQuoteNotes(q);
  }

  // 展示当前名句的「解析」+ 用户自己的理解（含历史）
  function renderQuoteNotes(q) {
    var noteEl = $('#quoteNote');
    if (noteEl) noteEl.textContent = q.note || '';
    var ta = $('#quoteMyNote');
    var recs = (state.quoteNotes && state.quoteNotes[q.text]) || [];
    if (ta) ta.value = recs.length ? recs[recs.length - 1].note : '';
    renderNoteHistory(q.text);
    updateFavBtn(q.text);
  }

  function isFav(text) {
    return Array.isArray(state.favorites) && state.favorites.indexOf(text) !== -1;
  }

  function updateFavBtn(text) {
    var btn = $('#favBtn');
    if (!btn) return;
    var on = isFav(text);
    btn.textContent = on ? '★ 已收藏' : '☆ 收藏此句';
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function toggleFavorite() {
    if (!state.favorites || !Array.isArray(state.favorites)) state.favorites = [];
    var t = currentQuoteText;
    var i = state.favorites.indexOf(t);
    if (i === -1) {
      state.favorites.push(t);
      toast('已收藏这句');
    } else {
      state.favorites.splice(i, 1);
      toast('已取消收藏');
    }
    state.favAt = Date.now();
    save();
    updateFavBtn(t);
    renderFavorites();
  }

  // 收藏夹：句子 + 你的理解（站点解析）+ 我的理解，逐条对应
  function renderFavorites() {
    var list = $('#favList');
    var empty = $('#favEmpty');
    var count = $('#favCount');
    if (!list) return;
    var favs = Array.isArray(state.favorites) ? state.favorites : [];
    if (count) count.textContent = favs.length + ' 句';
    if (!favs.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    var html = '';
    favs.forEach(function (text) {
      var q = FAMOUS_QUOTES.filter(function (x) { return x.text === text; })[0];
      if (!q) return;
      html += '<article class="fav-card">';
      html += '<blockquote class="fav-quote">' + escapeHtml(q.text) + '</blockquote>';
      html += '<p class="fav-from">—— ' + escapeHtml(q.from) + '</p>';
      // 你的理解（站点解析）—— 斜体小字，放在句子下方
      html += '<p class="fav-note fav-note-site">解析 · ' + escapeHtml(q.note || '') + '</p>';
      // 我的理解（用户记录）—— 斜体小字
      var recs = (state.quoteNotes && state.quoteNotes[text]) || [];
      if (recs.length) {
        for (var i = recs.length - 1; i >= 0; i--) {
          html += '<p class="fav-note fav-note-mine"><span class="fav-note-tag">我的 · ' +
            fmtStamp(recs[i].t) + '</span>' + escapeHtml(recs[i].note) + '</p>';
        }
      } else {
        html += '<p class="fav-note fav-note-mine fav-note-muted">（还没写自己的理解，去名句页补一句吧）</p>';
      }
      html += '<button class="fav-remove" type="button" data-text="' + escapeHtml(text) + '">取消收藏</button>';
      html += '</article>';
    });
    list.innerHTML = html;
  }

  function fmtStamp(ms) {
    var d = new Date(ms);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderNoteHistory(text) {
    var box = $('#noteHistory');
    if (!box) return;
    var recs = (state.quoteNotes && state.quoteNotes[text]) || [];
    if (!recs.length) {
      box.innerHTML = '<p class="qnc-empty">还没有记录，写下第一句吧。</p>';
      return;
    }
    var html = '';
    for (var i = recs.length - 1; i >= 0; i--) {
      html += '<div class="note-item">' +
        '<span class="note-time">' + fmtStamp(recs[i].t) + '</span>' +
        '<p class="note-text">' + escapeHtml(recs[i].note) + '</p></div>';
    }
    box.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function saveNote() {
    var ta = $('#quoteMyNote');
    if (!ta) return;
    var val = ta.value.trim();
    if (!val) { toast('写点什么再保存吧'); return; }
    if (!state.quoteNotes) state.quoteNotes = {};
    if (!state.quoteNotes[currentQuoteText] || !Array.isArray(state.quoteNotes[currentQuoteText])) {
      state.quoteNotes[currentQuoteText] = [];
    }
    state.quoteNotes[currentQuoteText].push({ t: Date.now(), note: val });
    save();
    toast('已保存你的理解');
    renderNoteHistory(currentQuoteText);
  }

  function openAllNotes() {
    var list = $('#allNotesList');
    if (!list) return;
    var texts = Object.keys(state.quoteNotes || {}).filter(function (t) {
      return Array.isArray(state.quoteNotes[t]) && state.quoteNotes[t].length;
    });
    if (!texts.length) {
      list.innerHTML = '<p class="qnc-empty">还没有任何记录，去名句页写下第一句吧。</p>';
    } else {
      // 按最近一次记录时间倒序
      texts.sort(function (a, b) {
        var ra = state.quoteNotes[a], rb = state.quoteNotes[b];
        return rb[rb.length - 1].t - ra[ra.length - 1].t;
      });
      var html = '';
      texts.forEach(function (text) {
        var recs = state.quoteNotes[text];
        var meta = FAMOUS_QUOTES.filter(function (q) { return q.text === text; })[0];
        html += '<div class="notes-group">' +
          '<div class="notes-q"><span class="notes-q-text">' + escapeHtml(text) + '</span>' +
          (meta ? '<span class="notes-q-from">' + escapeHtml(meta.from) + '</span>' : '') + '</div>';
        for (var i = recs.length - 1; i >= 0; i--) {
          html += '<div class="note-item">' +
            '<span class="note-time">' + fmtStamp(recs[i].t) + '</span>' +
            '<p class="note-text">' + escapeHtml(recs[i].note) + '</p></div>';
        }
        html += '</div>';
      });
      list.innerHTML = html;
    }
    var modal = $('#notesModal');
    if (modal) modal.hidden = false;
  }

  function closeAllNotes() {
    var modal = $('#notesModal');
    if (modal) modal.hidden = true;
  }

  function refreshQuote() {
    var n = FAMOUS_QUOTES.length;
    if (n > 1) {
      // 从牌堆顺序抽；抽空了再洗一副新的（排除当前这句，避免立刻重复）
      quotePos++;
      if (quotePos >= quoteDeck.length) {
        quoteDeck = buildDeck(quoteIndex);
        quotePos = 0;
      }
      quoteIndex = quoteDeck[quotePos];
    }
    renderQuotes();
    var textEl = $('#quoteBigText');
    if (textEl && !reduced()) {
      textEl.classList.remove('is-swap');
      void textEl.offsetWidth;
      textEl.classList.add('is-swap');
    }
    toast('换了一句');
  }

  /* ---------------- 渲染：学习工具 ---------------- */
  function fmt(n, dec) {
    if (!isFinite(n)) return '—';
    var d = (dec == null) ? 4 : dec;
    var v = parseFloat(Number(n).toFixed(d));
    if (Object.is(v, -0)) v = 0;
    return String(v);
  }

  function showResult(box, html, isError) {
    if (!box) return;
    box.hidden = false;
    box.innerHTML = html;
    box.classList.toggle('is-error', !!isError);
  }

  function solveQuadratic() {
    var box = $('#quadResult');
    var a = parseFloat($('#qa').value);
    var b = parseFloat($('#qb').value);
    var c = parseFloat($('#qc').value);
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) {
      showResult(box, '<p class="res-strong">请输入 a、b、c 三个数字</p>', true);
      return;
    }
    if (a === 0) {
      if (b === 0) {
        showResult(box, c === 0
          ? '<p class="res-strong">任意 x 都成立（0 = 0）</p>'
          : '<p class="res-strong">无解：' + fmt(c) + ' ≠ 0</p>', true);
        return;
      }
      showResult(box,
        '<p class="res-line res-sub">a = 0，退化为一次方程 ' + fmt(b) + 'x + ' + fmt(c) + ' = 0</p>' +
        '<p class="res-strong">x = ' + fmt(-c / b) + '</p>');
      return;
    }

    var D = b * b - 4 * a * c;
    var html = '<p class="res-line">判别式 Δ = b² − 4ac = ' + fmt(D) + '</p>';
    if (D > 0) {
      var s = Math.sqrt(D);
      html += '<p class="res-strong">两个不相等的实根</p>';
      html += '<p class="res-line">x₁ = ' + fmt((-b + s) / (2 * a)) + '　　x₂ = ' + fmt((-b - s) / (2 * a)) + '</p>';
    } else if (D === 0) {
      html += '<p class="res-strong">两个相等的实根（重根）</p>';
      html += '<p class="res-line">x = ' + fmt(-b / (2 * a)) + '</p>';
    } else {
      var re = -b / (2 * a), im = Math.sqrt(-D) / (2 * a);
      html += '<p class="res-strong">没有实数根，是一对共轭复根</p>';
      html += '<p class="res-line">x = ' + fmt(re) + ' ± ' + fmt(Math.abs(im)) + ' i</p>';
    }
    var vx = -b / (2 * a), vy = (4 * a * c - b * b) / (4 * a);
    html += '<p class="res-line res-sub">顶点 (' + fmt(vx) + ', ' + fmt(vy) + ')　对称轴 x = ' + fmt(vx) +
      '　开口' + (a > 0 ? '向上' : '向下') + '</p>';
    showResult(box, html);
  }

  /* 目标分的单位：raw = 与得分同单位的卷面分；pct = 百分制 */
  var scoreUnit = 'raw';

  function calcScore() {
    var box = $('#scoreResult');
    var got = parseFloat($('#scGot').value);
    var total = parseFloat($('#scTotal').value);
    var target = parseFloat($('#scTarget').value);
    if (!isFinite(got) || !isFinite(total) || total <= 0) {
      showResult(box, '<p class="res-strong">请填写得分和满分（满分需大于 0）</p>', true);
      return;
    }
    if (got < 0 || got > total) {
      showResult(box, '<p class="res-strong">得分应在 0 到满分之间</p>', true);
      return;
    }
    var pct = got / total * 100;
    var level = pct >= 90 ? '优秀' : pct >= 80 ? '良好' : pct >= 60 ? '及格' : '不及格';
    var html = '<p class="res-strong">百分制 ' + fmt(pct, 1) + ' 分 · ' + level + '</p>';
    html += '<p class="res-line">' + fmt(got) + ' / ' + fmt(total) + ' 换算为 ' + fmt(pct, 1) + ' / 100</p>';

    if (isFinite(target) && target >= 0) {
      // 把目标统一换成两种刻度，避免拿卷面分去减百分制
      var targetRaw = scoreUnit === 'raw' ? target : target / 100 * total;
      var targetPct = scoreUnit === 'raw' ? target / total * 100 : target;
      var cap = scoreUnit === 'raw' ? total : 100;

      if (target > cap + 1e-9) {
        showResult(box, html + '<p class="res-line res-sub">目标不能超过满分 ' +
          fmt(cap) + (scoreUnit === 'raw' ? ' 分' : ' 分（百分制）') + '。</p>', true);
        return;
      }

      var label = '目标 ' + fmt(targetPct, 1) + ' / 100' +
        (scoreUnit === 'raw'
          ? '（卷面 ' + fmt(targetRaw, 1) + ' / ' + fmt(total) + '）'
          : '（卷面约 ' + fmt(targetRaw, 1) + ' / ' + fmt(total) + '）');
      html += '<p class="res-line res-sub">' + label + '</p>';

      // 统一在卷面刻度上比较，差值就是实实在在差几分
      var diff = got - targetRaw;
      if (diff >= -1e-9) {
        html += '<p class="res-line res-sub">已达成' +
          (diff > 1e-9
            ? '，卷面比目标多 ' + fmt(diff, 1) + ' 分。'
            : '，正好压线，稳住。') + '</p>';
      } else {
        html += '<p class="res-line res-sub">还差 ' + fmt(-diff, 1) + ' 分（卷面），百分制差 ' +
          fmt(targetPct - pct, 1) + ' 分。</p>';
        html += '<p class="res-line res-sub">下次卷面至少 ' + fmt(targetRaw, 1) + ' / ' + fmt(total) +
          ' 就能达标。</p>';
      }
    }
    showResult(box, html);
  }

  function isPrime(n) {
    if (n < 2) return false;
    if (n % 2 === 0) return n === 2;
    for (var i = 3; i * i <= n; i += 2) if (n % i === 0) return false;
    return true;
  }

  function factorize(n) {
    var out = [];
    var m = n;
    for (var p = 2; p * p <= m; p++) {
      if (m % p === 0) {
        var e = 0;
        while (m % p === 0) { m /= p; e++; }
        out.push(e > 1 ? p + '<sup>' + e + '</sup>' : String(p));
      }
    }
    if (m > 1) out.push(String(m));
    return out;
  }

  function calcPrime() {
    var box = $('#primeResult');
    var n = parseInt($('#pn').value, 10);
    if (!isFinite(n) || n < 2) {
      showResult(box, '<p class="res-strong">请输入 2 或更大的整数</p>', true);
      return;
    }
    if (n > 1000000000000) {
      showResult(box, '<p class="res-strong">数字太大啦，换个小一点的吧</p>', true);
      return;
    }
    if (isPrime(n)) {
      showResult(box,
        '<p class="res-strong">' + n + ' 是质数</p>' +
        '<p class="res-line">它只能被 1 和它自己整除。</p>');
    } else {
      showResult(box,
        '<p class="res-strong">' + n + ' 不是质数（合数）</p>' +
        '<p class="res-line">' + n + ' = ' + factorize(n).join(' × ') + '</p>');
    }
  }

  function renderTools() { /* 工具为静态结构，结果保留在 DOM 中 */ }

  /* ---------------- 工具 04：一元二次不等式 ---------------- */
  var inequalSign = 'gt';

  function solveInequal() {
    var box = $('#inequalResult');
    var a = parseFloat($('#ia').value);
    var b = parseFloat($('#ib').value);
    var c = parseFloat($('#ic').value);
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) {
      showResult(box, '<p class="res-strong">请填写 a、b、c 三个系数</p>', true);
      return;
    }
    if (a === 0) {
      showResult(box, '<p class="res-strong">a = 0 不是二次不等式，请换成一次函数工具。</p>', true);
      return;
    }
    var sign = inequalSign;
    var D = b * b - 4 * a * c;
    var html = '<p class="res-strong">' + fmt(a, 0) + 'x² ' + (b >= 0 ? '+ ' : '− ') + fmt(Math.abs(b), 0) +
      'x ' + (c >= 0 ? '+ ' : '− ') + fmt(Math.abs(c), 0) +
      ' ' + ({ gt: '> 0', ge: '≥ 0', lt: '< 0', le: '≤ 0' })[sign] + '</p>';

    if (D < 0) {
      // 无实根：整条实数轴符号恒为 a 的符号
      var up = (sign === 'gt' || sign === 'ge') ? a > 0 : a < 0;
      html += '<p class="res-line">判别式 Δ = ' + fmt(D, 1) + ' &lt; 0，无实根。</p>';
      html += '<p class="res-line res-sub">' + (up ? '恒成立，解集为全体实数 ℝ。' : '无解，解集为空 ∅。') + '</p>';
    } else if (D === 0) {
      var r0 = -b / (2 * a);
      html += '<p class="res-line">判别式 Δ = 0，唯一根 x = ' + fmt(r0, 2) + '。</p>';
      var include0 = (sign === 'ge' || sign === 'le');
      if ((sign === 'gt' || sign === 'lt')) {
        html += '<p class="res-line res-sub">解集为 x ≠ ' + fmt(r0, 2) + ' 的一切实数（x = ' + fmt(r0, 2) + ' 处取 0，不取）。</p>';
      } else {
        html += '<p class="res-line res-sub">解集为全体实数 ℝ（x = ' + fmt(r0, 2) + ' 处恰为 0，' + (include0 ? '可取' : '不取') + '）。</p>';
      }
    } else {
      var s = Math.sqrt(D);
      var r1 = (-b - s) / (2 * a), r2 = (-b + s) / (2 * a);
      if (r1 > r2) { var t = r1; r1 = r2; r2 = t; }
      html += '<p class="res-line">Δ = ' + fmt(D, 1) + ' &gt; 0，两根 x₁ = ' + fmt(r1, 2) + '，x₂ = ' + fmt(r2, 2) + '。</p>';
      var iOpen = '(' + fmt(r1, 2) + ', ' + fmt(r2, 2) + ')';
      var iClosed = '[' + fmt(r1, 2) + ', ' + fmt(r2, 2) + ']';
      var oOpen = '(-∞, ' + fmt(r1, 2) + ') ∪ (' + fmt(r2, 2) + ', +∞)';
      var oClosed = '(-∞, ' + fmt(r1, 2) + '] ∪ [' + fmt(r2, 2) + ', +∞)';
      // a>0：开口向上，根之间为负、根外为正；a<0 则相反
      if (a > 0) {
        if (sign === 'gt') html += '<p class="res-line res-sub">开口向上，根外为正：' + oOpen + '。</p>';
        else if (sign === 'ge') html += '<p class="res-line res-sub">开口向上，根外及根上为正：' + oClosed + '。</p>';
        else if (sign === 'lt') html += '<p class="res-line res-sub">开口向上，两根之间为负：' + iOpen + '。</p>';
        else html += '<p class="res-line res-sub">开口向上，两根之间及根上为负：' + iClosed + '。</p>';
      } else {
        if (sign === 'gt') html += '<p class="res-line res-sub">开口向下，两根之间为正：' + iOpen + '。</p>';
        else if (sign === 'ge') html += '<p class="res-line res-sub">开口向下，两根之间及根上为正：' + iClosed + '。</p>';
        else if (sign === 'lt') html += '<p class="res-line res-sub">开口向下，根外为负：' + oOpen + '。</p>';
        else html += '<p class="res-line res-sub">开口向下，根外及根上为负：' + oClosed + '。</p>';
      }
    }
    showResult(box, html);
  }

  /* ---------------- 工具 05：随机抽背 ---------------- */
  var drillLast = -1;
  function drawDrill() {
    var box = $('#drillResult');
    var raw = $('#drillInput').value;
    var items = raw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (items.length === 0) {
      showResult(box, '<p class="res-strong">先在上面写几行要背的，每行一个</p>', true);
      return;
    }
    if (items.length === 1) {
      showResult(box, '<p class="res-strong">抽到：' + items[0] + '</p>');
      drillLast = 0;
      return;
    }
    var idx = drillLast;
    while (idx === drillLast) idx = Math.floor(Math.random() * items.length);
    drillLast = idx;
    showResult(box, '<p class="res-strong">抽到：' + items[idx] + '</p>' +
      '<p class="res-line res-sub">第 ' + (idx + 1) + ' 条，共 ' + items.length + ' 条。</p>');
  }

  /* ---------------- 工具 06：专注番茄钟 ---------------- */
  var focusTimer = null, focusTotal = 0, focusLeft = 0, focusRunning = false;
  var FOCUS_BAR_C = 2 * Math.PI * 54;
  function focusRender() {
    var m = Math.floor(focusLeft / 60), s = focusLeft % 60;
    var txt = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    var ce = $('#focusClock'); if (ce) ce.textContent = txt;
    var bar = $('#focusBar');
    if (bar) {
      var frac = focusTotal > 0 ? focusLeft / focusTotal : 0;
      bar.style.strokeDasharray = FOCUS_BAR_C;
      bar.style.strokeDashoffset = FOCUS_BAR_C * (1 - frac);
    }
  }
  function focusStop() {
    focusRunning = false;
    if (focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  }
  function focusTick() {
    focusLeft--;
    if (focusLeft <= 0) {
      focusLeft = 0; focusRender(); focusStop();
      var btn = $('#focusStart'); if (btn) btn.textContent = '开始';
      var hint = $('#focusHint'); if (hint) hint.textContent = '时间到，起来走两步、喝口水。';
      toast('专注结束，休息一下 ☕');
      return;
    }
    focusRender();
  }
  function focusStart() {
    var min = parseFloat($('#focusMin').value);
    if (!isFinite(min) || min < 1) min = 25;
    if (focusTotal === 0 || focusLeft === 0) { focusTotal = Math.round(min * 60); focusLeft = focusTotal; }
    if (focusRunning) {
      focusStop();
      var b = $('#focusStart'); if (b) b.textContent = '继续';
      var h = $('#focusHint'); if (h) h.textContent = '已暂停，点「继续」接着算。';
      return;
    }
    focusRunning = true;
    var b2 = $('#focusStart'); if (b2) b2.textContent = '暂停';
    var h2 = $('#focusHint'); if (h2) h2.textContent = '专注中…尽量别切走。';
    focusTimer = setInterval(focusTick, 1000);
    focusRender();
  }
  function focusReset() {
    focusStop();
    var min = parseFloat($('#focusMin').value);
    if (!isFinite(min) || min < 1) min = 25;
    focusTotal = Math.round(min * 60); focusLeft = focusTotal;
    var b = $('#focusStart'); if (b) b.textContent = '开始';
    var h = $('#focusHint'); if (h) h.textContent = '点「开始」进入专注，建议先关掉别的标签页。';
    focusRender();
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
    else if (view === 'tools') renderTools();
    else if (view === 'mistakes') renderMistakes();
    else if (view === 'quotes') renderQuotes();
    else if (view === 'favorites') renderFavorites();
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
    // 记录这一天清单的最后修改时间：同步时按它决定以哪一端为准
    if (!state.checkinAt || typeof state.checkinAt !== 'object') state.checkinAt = {};
    state.checkinAt[k] = Date.now();
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
        // 留一条 del 标记参与同步：直接 delete 的话，另一台设备会把旧复盘合并回来
        state.reviews[key] = { t1: '', t2: '', t3: '', at: Date.now(), del: true };
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
      var signedIn = !!syncUser;
      openConfirm({
        title: '确定清空所有数据？',
        text: signedIn
          ? '本机与云端的打卡、复盘、错题、笔记和收藏都会被删除，其他设备在下次同步后也会一并清空，且无法恢复。'
          : '打卡记录、每周复盘、错题、笔记和收藏都会被删除，且无法恢复。',
        confirmText: '确认清空',
        onConfirm: function () {
          state = defaultState();
          state.resetAt = Date.now();
          try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
          save();
          dailyDate = new Date();
          reviewWeekKey = null;
          mkFilter = 'all';
          renderView(activeView);
          toast(signedIn ? '已清空，云端会一起清空' : '已清空，重新开始');
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

  /* ---------------- 名句 / 工具交互 ---------------- */
  var quoteRefreshBtn = $('#quoteRefresh');
  if (quoteRefreshBtn) quoteRefreshBtn.addEventListener('click', refreshQuote);

  // 名句：保存/历史/全部记录
  var saveNoteBtn = $('#saveNote');
  if (saveNoteBtn) saveNoteBtn.addEventListener('click', saveNote);
  var toggleHistoryBtn = $('#toggleHistory');
  if (toggleHistoryBtn) toggleHistoryBtn.addEventListener('click', function () {
    var box = $('#noteHistory');
    if (!box) return;
    var open = box.hidden;
    box.hidden = !open;
    toggleHistoryBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggleHistoryBtn.textContent = open ? '收起历史' : '查看历史';
    if (open) renderNoteHistory(currentQuoteText);
  });
  var allNotesBtn = $('#allNotesBtn');
  if (allNotesBtn) allNotesBtn.addEventListener('click', openAllNotes);
  var notesModalClose = $('#notesModalClose');
  if (notesModalClose) notesModalClose.addEventListener('click', closeAllNotes);
  var notesModal = $('#notesModal');
  if (notesModal) notesModal.addEventListener('click', function (e) { if (e.target === notesModal) closeAllNotes(); });

  // 收藏
  var favBtn = $('#favBtn');
  if (favBtn) favBtn.addEventListener('click', toggleFavorite);
  var favList = $('#favList');
  if (favList) favList.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.fav-remove') : null;
    if (!btn) return;
    var t = btn.getAttribute('data-text');
    var i = state.favorites.indexOf(t);
    if (i !== -1) {
      state.favorites.splice(i, 1);
      state.favAt = Date.now();
      save();
      toast('已取消收藏');
      renderFavorites();
      updateFavBtn(currentQuoteText);
    }
  });

  var solveQuadBtn = $('#solveQuad');
  if (solveQuadBtn) solveQuadBtn.addEventListener('click', solveQuadratic);
  var calcScoreBtn = $('#calcScore');
  if (calcScoreBtn) calcScoreBtn.addEventListener('click', calcScore);

  // 目标分单位切换：切换后若已有结果，顺手重算一次
  var scoreUnitBox = $('#scoreUnit');
  if (scoreUnitBox) {
    scoreUnitBox.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.unit-chip') : null;
      if (!chip) return;
      scoreUnit = chip.getAttribute('data-unit') === 'pct' ? 'pct' : 'raw';
      Array.prototype.forEach.call(scoreUnitBox.querySelectorAll('.unit-chip'), function (el) {
        var on = el === chip;
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var box = $('#scoreResult');
      if (box && !box.hidden) calcScore();
    });
  }
  var calcPrimeBtn = $('#calcPrime');
  if (calcPrimeBtn) calcPrimeBtn.addEventListener('click', calcPrime);

  // 04 一元二次不等式
  var solveInequalBtn = $('#solveInequal');
  if (solveInequalBtn) solveInequalBtn.addEventListener('click', solveInequal);
  var inequalSignBox = $('#inequalSign');
  if (inequalSignBox) {
    inequalSignBox.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.unit-chip') : null;
      if (!chip) return;
      inequalSign = chip.getAttribute('data-sign') || 'gt';
      Array.prototype.forEach.call(inequalSignBox.querySelectorAll('.unit-chip'), function (el) {
        var on = el === chip;
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var box = $('#inequalResult');
      if (box && !box.hidden) solveInequal();
    });
  }

  // 05 随机抽背
  var drawDrillBtn = $('#drawDrill');
  if (drawDrillBtn) drawDrillBtn.addEventListener('click', drawDrill);

  // 06 专注番茄钟
  var focusStartBtn = $('#focusStart');
  if (focusStartBtn) focusStartBtn.addEventListener('click', focusStart);
  var focusResetBtn = $('#focusReset');
  if (focusResetBtn) focusResetBtn.addEventListener('click', focusReset);
  var focusMinEl = $('#focusMin');
  if (focusMinEl) focusMinEl.addEventListener('change', focusReset);

  // 在输入框里按回车也能直接计算
  [['#qa', solveQuadratic], ['#qb', solveQuadratic], ['#qc', solveQuadratic],
   ['#scGot', calcScore], ['#scTotal', calcScore], ['#scTarget', calcScore],
   ['#pn', calcPrime],
   ['#ia', solveInequal], ['#ib', solveInequal], ['#ic', solveInequal]].forEach(function (pair) {
    var el = $(pair[0]);
    if (el) el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); pair[1](); }
    });
  });

  /* ---------------- 错题本交互 ---------------- */
  var mkAddBtn = $('#mkAdd');
  if (mkAddBtn) mkAddBtn.addEventListener('click', addMistake);

  var mkTitleEl = $('#mkTitle');
  if (mkTitleEl) {
    mkTitleEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addMistake(); }
    });
  }

  var mkSubjectsBox = $('#mkSubjects');
  if (mkSubjectsBox) {
    mkSubjectsBox.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.unit-chip') : null;
      if (!chip) return;
      mkSubject = chip.getAttribute('data-subject') || '语文';
      renderMistakes();
    });
  }

  var mkFiltersBox = $('#mkFilters');
  if (mkFiltersBox) {
    mkFiltersBox.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.unit-chip') : null;
      if (!chip) return;
      mkFilter = chip.getAttribute('data-filter') || 'all';
      renderMistakes();
    });
  }

  var mkListBox = $('#mkList');
  if (mkListBox) {
    mkListBox.addEventListener('click', function (e) {
      var del = e.target.closest ? e.target.closest('[data-del-mk]') : null;
      if (del) {
        e.preventDefault();
        deleteMistake(del.getAttribute('data-del-mk'));
        return;
      }
      var check = e.target.closest ? e.target.closest('.mk-check') : null;
      if (!check) return;
      var item = check.closest('.mk-item');
      if (item) toggleMistake(item.getAttribute('data-id'));
    });
  }

  /* ============================================================
     云端同步（Supabase）
     · 本机数据仍是主线：未登录 / 断网时一切功能照旧
     · 登录后：拉取云端 → 与本地按记录合并 → 回写云端
     ============================================================ */
  var CLOUD = {
    url: 'https://eifsqvpqzaxnqijijvyi.supabase.co',
    key: 'sb_publishable__KdVGu89KVi1N1519pHAwA_jlrWGheu',
    table: 'zhixing_saves',
    meta: 'zhixing.study.sync.v1'
  };

  var cloud = null;              // supabase client
  var syncUser = null;           // { id, email }
  var syncBusy = false;
  var syncQueued = false;
  var pushTimer = null;
  var retryTimer = null;
  var retryCount = 0;
  var syncStatus = 'idle';       // idle | syncing | synced | error
  var syncError = '';
  var syncMeta = readSyncMeta();

  function readSyncMeta() {
    try {
      var raw = localStorage.getItem(CLOUD.meta);
      var p = raw ? JSON.parse(raw) : null;
      return {
        lastSyncedAt: p && typeof p.lastSyncedAt === 'number' ? p.lastSyncedAt : 0,
        email: p && typeof p.email === 'string' ? p.email : ''
      };
    } catch (e) {
      return { lastSyncedAt: 0, email: '' };
    }
  }

  function writeSyncMeta() {
    try { localStorage.setItem(CLOUD.meta, JSON.stringify(syncMeta)); } catch (e) { /* ignore */ }
  }

  function cloudReady() { return !!(cloud && syncUser); }

  /* ---- 合并：集合类按记录合，标量类取最后修改的那一份 ---- */
  function eachKey(a, b, fn) {
    var seen = {};
    [a, b].forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      Object.keys(m).forEach(function (k) {
        if (seen[k]) return;
        seen[k] = 1;
        fn(k);
      });
    });
  }

  // 打卡：同一天以「最后一次修改」为准。
  // （早先用并集，导致取消勾选永远传不出去——同步一拉就又被加回来）
  function mergeCheckins(localS, remoteS) {
    var a = localS.checkins || {}, b = remoteS.checkins || {};
    var atA = localS.checkinAt || {}, atB = remoteS.checkinAt || {};
    var out = {}, outAt = {};
    var keys = {};
    [a, b, atA, atB].forEach(function (m) {
      Object.keys(m || {}).forEach(function (k) { keys[k] = 1; });
    });
    Object.keys(keys).forEach(function (k) {
      var ta = atA[k] || 0, tb = atB[k] || 0;
      var arr = (ta >= tb) ? a[k] : b[k];
      if (Array.isArray(arr) && arr.length) out[k] = arr.slice();
      outAt[k] = Math.max(ta, tb);
    });
    return { checkins: out, checkinAt: outAt };
  }

  // 收藏：整份列表按最后一次修改取舍（并集同样会让「取消收藏」失效）
  function mergeFavorites(localS, remoteS) {
    var la = localS.favAt || 0, rb = remoteS.favAt || 0;
    var list = (rb > la) ? remoteS.favorites : localS.favorites;
    return {
      favorites: Array.isArray(list) ? list.slice() : [],
      favAt: Math.max(la, rb)
    };
  }

  function mergeReviews(a, b) {
    var out = {};
    eachKey(a, b, function (k) {
      var ra = a && a[k], rb = b && b[k];
      if (!ra) { out[k] = rb; return; }
      if (!rb) { out[k] = ra; return; }
      out[k] = ((rb.at || 0) > (ra.at || 0)) ? rb : ra;
    });
    return out;
  }

  function mergeMistakes(a, b) {
    var byId = {};
    (Array.isArray(a) ? a : []).concat(Array.isArray(b) ? b : []).forEach(function (m) {
      if (!m || !m.id) return;
      var cur = byId[m.id];
      if (!cur) { byId[m.id] = m; return; }
      if ((m.upd || m.at || 0) >= (cur.upd || cur.at || 0)) byId[m.id] = m;
    });
    return Object.keys(byId).map(function (k) { return byId[k]; });
  }

  function mergeNotes(a, b) {
    var out = {};
    eachKey(a, b, function (k) {
      var list = [], seen = {};
      [a, b].forEach(function (m) {
        var recs = m && Array.isArray(m[k]) ? m[k] : [];
        recs.forEach(function (r) {
          if (!r || typeof r.note !== 'string') return;
          var sig = String(r.t || 0) + '|' + r.note;
          if (seen[sig]) return;
          seen[sig] = 1;
          list.push(r);
        });
      });
      list.sort(function (x, y) { return (x.t || 0) - (y.t || 0); });
      if (list.length) out[k] = list;
    });
    return out;
  }

  function unionList(a, b) {
    var out = [];
    [a, b].forEach(function (arr) {
      (Array.isArray(arr) ? arr : []).forEach(function (v) {
        if (typeof v === 'string' && out.indexOf(v) < 0) out.push(v);
      });
    });
    return out;
  }

  function mergeStates(localS, remoteS) {
    // 「清空数据」以较晚的那次为准：整份覆盖，避免旧记录被合并回来
    if (remoteS.resetAt && remoteS.resetAt > (localS.resetAt || 0)) return remoteS;
    if (localS.resetAt && localS.resetAt > (remoteS.resetAt || 0)) return localS;

    var newer = (remoteS.updatedAt || 0) > (localS.updatedAt || 0) ? remoteS : localS;
    var trash = unionList(localS.mkTrash, remoteS.mkTrash);
    var mistakes = mergeMistakes(localS.mistakes, remoteS.mistakes).filter(function (m) {
      return trash.indexOf(m.id) < 0;
    });
    var ck = mergeCheckins(localS, remoteS);
    var fv = mergeFavorites(localS, remoteS);
    return {
      nickname: newer.nickname || '',
      startDate: newer.startDate || localS.startDate,
      settings: Object.assign({}, localS.settings, newer.settings),
      goals: Object.assign({}, localS.goals, newer.goals),
      checkins: ck.checkins,
      checkinAt: ck.checkinAt,
      reviews: mergeReviews(localS.reviews, remoteS.reviews),
      mistakes: mistakes,
      quoteNotes: mergeNotes(localS.quoteNotes, remoteS.quoteNotes),
      favorites: fv.favorites,
      favAt: fv.favAt,
      mkTrash: trash,
      updatedAt: Math.max(localS.updatedAt || 0, remoteS.updatedAt || 0),
      resetAt: Math.max(localS.resetAt || 0, remoteS.resetAt || 0)
    };
  }

  /* ---- 读写云端 ---- */
  function pullFromCloud() {
    return cloud.from(CLOUD.table)
      .select('data, updated_at')
      .eq('user_id', syncUser.id)
      .maybeSingle()
      .then(function (res) {
        if (res && res.error) throw res.error;
        return (res && res.data) || null;
      });
  }

  function pushToCloud() {
    return cloud.from(CLOUD.table)
      .upsert({ user_id: syncUser.id, data: state }, { onConflict: 'user_id' })
      .then(function (res) {
        if (res && res.error) throw res.error;
      });
  }

  function syncNow(reason) {
    if (!cloudReady()) return;
    if (syncBusy) { syncQueued = true; return; }
    syncBusy = true;
    syncStatus = 'syncing';
    syncError = '';
    renderSyncUI();

    var changed = false;
    pullFromCloud().then(function (row) {
      if (row && row.data) {
        var before = JSON.stringify(state);
        state = mergeStates(state, normalizeState(row.data));
        if (JSON.stringify(state) !== before) changed = true;
        if (changed) saveLocal();
      }
      return pushToCloud();
    }).then(function () {
      syncMeta.lastSyncedAt = Date.now();
      syncMeta.email = syncUser.email || '';
      writeSyncMeta();
      syncStatus = 'synced';
      syncBusy = false;
      retryCount = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      renderSyncUI();
      if (changed) refreshAfterSync();
      if (syncQueued) { syncQueued = false; syncNow('queued'); }
    }).catch(function (err) {
      syncStatus = 'error';
      syncError = describeCloudError(err);
      syncBusy = false;
      // 服务端瞬时故障（52x 网关错误、超时、断网）自动重试，退避 8s/16s/32s/60s
      if (cloudReady() && isTransientError(err) && retryCount < 4) {
        retryCount++;
        var wait = Math.min(60000, 8000 * Math.pow(2, retryCount - 1));
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
          retryTimer = null;
          syncNow('retry');
        }, wait);
        syncError += '，' + Math.round(wait / 1000) + ' 秒后自动重试';
      }
      renderSyncUI();
    });
  }

  // 只有「过一会儿可能自己好」的错误才自动重试
  function isTransientError(err) {
    var m = ((err && (err.message || err.msg || err.error_description)) || '') + ' ' + ((err && err.code) || '') + ' ' + ((err && err.status) || '');
    return /521|522|523|502|503|504|Unexpected token|Failed to fetch|NetworkError|load failed|timed? ?out|ETIMEDOUT|ECONNRESET/i.test(m);
  }

  function scheduleCloudPush() {
    if (!cloudReady()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      syncNow('local');
    }, 1200);
  }

  function refreshAfterSync() {
    try {
      renderView(activeView);
      updateSideStreak();
    } catch (e) { /* 单次渲染失败不影响数据 */ }
  }

  function describeCloudError(err) {
    var m = (err && (err.message || err.error_description || err.msg)) || '';
    if (/Invalid login credentials/i.test(m)) return '邮箱或密码不对';
    if (/User already registered/i.test(m)) return '这个邮箱已注册，直接点登录';
    if (/Password should be at least/i.test(m)) return '密码太短了（至少 6 位）';
    if (/Email not confirmed/i.test(m)) return '邮箱还没验证，去 Supabase 关掉 Confirm email';
    if (/Auth session missing|session_not_found|Invalid Refresh Token|JWT expired/i.test(m)) return '登录状态过期了，退出后重新登录';
    if (/Unexpected token|is not valid JSON/i.test(m)) return '服务端返回异常，可能正在重启';
    var st = String((err && (err.code || err.status)) || '');
    if (/^(50[234]|52[0-9])$/.test(st)) return '服务端暂时不可用（' + st + '）';
    if (/should be different|different from the old/i.test(m)) return '新密码不能和旧密码一样';
    if (/weak|pwned/i.test(m)) return '这个密码太弱，换一个复杂点的';
    if (/rate limit|too many requests/i.test(m)) return '操作太频繁，等一下再试';
    if (/Failed to fetch|NetworkError|load failed/i.test(m)) return '网络连不上，稍后再试';
    if (/JWT|apikey|Invalid API key/i.test(m)) return '密钥无效';
    return m || '未知错误';
  }

  /* ---- 登录态 UI ---- */
  function fmtClock(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderSyncUI() {
    var badge = $('#syncBadge');
    var outBox = $('#syncSignedOut');
    var inBox = $('#syncSignedIn');
    var emailShow = $('#syncEmailShow');
    var statusText = $('#syncStatusText');
    if (!badge) return;

    var hasCloud = !!cloud;
    if (outBox) outBox.hidden = !!syncUser || !hasCloud;
    if (inBox) inBox.hidden = !syncUser;

    if (!hasCloud) {
      badge.textContent = '云端不可用';
      badge.setAttribute('data-state', 'off');
      if (outBox) outBox.hidden = false;
      var hint0 = $('#syncAuthHint');
      if (hint0) hint0.textContent = '云端组件没能加载，登录功能暂时不可用；本机记录照常保存。';
      var off = $('#syncLogin'), so = $('#syncSignup');
      if (off) off.disabled = true;
      if (so) so.disabled = true;
      return;
    }

    if (!syncUser) {
      badge.textContent = '未登录';
      badge.setAttribute('data-state', 'idle');
      return;
    }

    if (emailShow) emailShow.textContent = syncUser.email || '';
    var label = '已同步';
    var state = 'ok';
    var text = '尚未同步';
    if (syncStatus === 'syncing') { label = '同步中…'; state = 'busy'; text = '正在上传本机改动…'; }
    else if (syncStatus === 'error') { label = '同步失败'; state = 'err'; text = '同步失败：' + syncError; }
    else if (syncStatus === 'synced') { text = '已同步 · 最近一次 ' + fmtClock(syncMeta.lastSyncedAt); }
    else { label = '待同步'; state = 'idle'; }
    badge.textContent = label;
    badge.setAttribute('data-state', state);
    if (statusText) statusText.textContent = text;
  }

  function authSubmit(mode) {
    if (!cloud) return;
    var emailEl = $('#syncEmail');
    var passEl = $('#syncPassword');
    var hint = $('#syncAuthHint');
    var email = (emailEl && emailEl.value || '').trim();
    var pass = (passEl && passEl.value) || '';

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (hint) hint.textContent = '邮箱格式看起来不对，检查一下。';
      return;
    }
    if (pass.length < 6) {
      if (hint) hint.textContent = '密码至少 6 位。';
      return;
    }
    if (hint) hint.textContent = mode === 'signup' ? '正在注册…' : '正在登录…';

    var req = mode === 'signup'
      ? cloud.auth.signUp({ email: email, password: pass })
      : cloud.auth.signInWithPassword({ email: email, password: pass });

    Promise.resolve(req).then(function (res) {
      if (res && res.error) throw res.error;
      var session = res && res.data && res.data.session;
      if (mode === 'signup' && !session) {
        if (hint) hint.textContent = '注册成功，但还需要邮箱验证。请在 Supabase 里关掉 Confirm email 后再注册一次。';
        return;
      }
      if (passEl) passEl.value = '';
      if (hint) hint.textContent = '';
      var user = res && res.data && res.data.user;
      if (user) {
        syncUser = { id: user.id, email: user.email || email };
        syncStatus = 'idle';
        renderSyncUI();
        syncNow('login');
      }
    }).catch(function (err) {
      if (hint) hint.textContent = describeCloudError(err);
    });
  }

  function signOut() {
    if (!cloud) return;
    // scope=local：只清这台设备上的会话，不依赖一次网络往返，断网也能退出
    var done = function () {
      syncUser = null;
      syncStatus = 'idle';
      retryCount = 0;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
      closePwBox();
      renderSyncUI();
      toast('已退出登录，本机数据保留');
    };
    Promise.resolve(cloud.auth.signOut({ scope: 'local' })).then(done, done);
  }

  function onSignedIn(user) {
    syncUser = { id: user.id, email: user.email || '' };
    syncMeta.email = syncUser.email;
    writeSyncMeta();
    syncStatus = 'idle';
    renderSyncUI();
    syncNow('login');
  }

  function initCloud() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      cloud = null;
      renderSyncUI();
      return;
    }
    try {
      cloud = window.supabase.createClient(CLOUD.url, CLOUD.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'zhixing.study.auth'
        }
      });
    } catch (e) {
      cloud = null;
      renderSyncUI();
      return;
    }

    renderSyncUI();

    cloud.auth.getSession().then(function (res) {
      var s = res && res.data && res.data.session;
      if (s && s.user) onSignedIn(s.user);
      else renderSyncUI();
    }).catch(function () { renderSyncUI(); });

    cloud.auth.onAuthStateChange(function (event, session) {
      var u = session && session.user;
      if (u && (!syncUser || syncUser.id !== u.id)) onSignedIn(u);
      else if (!u && syncUser) { syncUser = null; syncStatus = 'idle'; renderSyncUI(); }
    });
  }

  function closePwBox() {
    var box = $('#syncPwBox');
    var toggle = $('#syncPwToggle');
    var m1 = $('#syncNewPass');
    var m2 = $('#syncNewPass2');
    var msg = $('#syncPwMsg');
    if (box) box.hidden = true;
    if (toggle) {
      toggle.textContent = '修改密码';
      toggle.setAttribute('aria-expanded', 'false');
    }
    if (m1) m1.value = '';
    if (m2) m2.value = '';
    if (msg) msg.textContent = '';
  }

  function saveNewPassword() {
    var p1 = $('#syncNewPass');
    var p2 = $('#syncNewPass2');
    var msg = $('#syncPwMsg');
    var v1 = p1 ? p1.value : '';
    var v2 = p2 ? p2.value : '';

    if (!cloud || !syncUser) {
      if (msg) msg.textContent = '还没登录，先登录再改密码。';
      return;
    }
    if (v1.length < 6) {
      if (msg) msg.textContent = '新密码至少 6 位。';
      return;
    }
    if (v1 !== v2) {
      if (msg) msg.textContent = '两次输入不一致，再对一遍。';
      return;
    }
    if (msg) msg.textContent = '正在保存…';

    Promise.resolve(cloud.auth.updateUser({ password: v1 })).then(function (res) {
      if (res && res.error) throw res.error;
      closePwBox();
      toast('密码已更新，下次用新密码登录');
    }).catch(function (err) {
      if (msg) msg.textContent = describeCloudError(err);
    });
  }

  function bindSyncUI() {
    var loginBtn = $('#syncLogin');
    var signupBtn = $('#syncSignup');
    var logoutBtn = $('#syncLogout');
    var nowBtn = $('#syncNow');
    var passEl = $('#syncPassword');

    if (loginBtn) loginBtn.addEventListener('click', function () { authSubmit('signin'); });
    if (signupBtn) signupBtn.addEventListener('click', function () { authSubmit('signup'); });
    if (logoutBtn) logoutBtn.addEventListener('click', signOut);
    if (nowBtn) nowBtn.addEventListener('click', function () {
      if (!syncUser) return;
      toast('开始同步…');
      syncNow('manual');
    });
    if (passEl) passEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); authSubmit('signin'); }
    });

    var pwToggle = $('#syncPwToggle');
    var pwSave = $('#syncPwSave');
    var pwCancel = $('#syncPwCancel');
    if (pwToggle) pwToggle.addEventListener('click', function () {
      var box = $('#syncPwBox');
      if (!box) return;
      if (box.hidden) {
        box.hidden = false;
        pwToggle.textContent = '收起';
        pwToggle.setAttribute('aria-expanded', 'true');
        var f = $('#syncNewPass');
        if (f) f.focus();
      } else {
        closePwBox();
      }
    });
    if (pwSave) pwSave.addEventListener('click', saveNewPassword);
    if (pwCancel) pwCancel.addEventListener('click', closePwBox);
    var np2 = $('#syncNewPass2');
    if (np2) np2.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveNewPassword(); }
    });

    window.addEventListener('online', function () { if (syncUser) syncNow('online'); });
    window.addEventListener('focus', function () {
      if (!syncUser || syncBusy) return;
      if (Date.now() - syncMeta.lastSyncedAt < 60000) return;
      syncNow('focus');
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

    bindSyncUI();
    initCloud();

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
