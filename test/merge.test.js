// 合并逻辑用例：从 app.js 里抽出「合并」代码块，直接跑断言（不连网、不需要账号）
// 运行：node test/merge.test.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = src.indexOf('/* ---- 合并');
const end = src.indexOf('/* ---- 读写云端');
if (start < 0 || end < 0) {
  console.error('找不到合并代码块：app.js 结构可能变了');
  process.exit(1);
}

const factory = new Function(
  src.slice(start, end) +
  '\nreturn { mergeStates: mergeStates, mergeCheckins: mergeCheckins, mergeFavorites: mergeFavorites };'
);
const M = factory();

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log('  \u2714 ' + name);
  } else {
    fail++;
    console.log('  \u2718 ' + name + '\n      实际 ' + a + '\n      期望 ' + e);
  }
}

function st(over) {
  return Object.assign({
    nickname: '', startDate: '2026-10-24',
    settings: { dailyReminder: true, weekendReminder: true },
    checkins: {}, checkinAt: {}, reviews: {}, goals: {},
    mistakes: [], quoteNotes: {}, favorites: [], favAt: 0,
    mkTrash: [], updatedAt: 0, resetAt: 0
  }, over);
}

console.log('打卡：取消勾选要能传出去');
eq('本地较新（刚取消一个）→ 以本地为准',
  M.mergeStates(st({ checkins: { D: ['b'] }, checkinAt: { D: 200 }, updatedAt: 200 }),
    st({ checkins: { D: ['a', 'b'] }, checkinAt: { D: 100 }, updatedAt: 150 })).checkins,
  { D: ['b'] });

eq('远端较新（另一台取消了一个）→ 以远端为准',
  M.mergeStates(st({ checkins: { D: ['a', 'b'] }, checkinAt: { D: 100 }, updatedAt: 100 }),
    st({ checkins: { D: ['b'] }, checkinAt: { D: 200 }, updatedAt: 200 })).checkins,
  { D: ['b'] });

eq('远端把当天全部取消 → 本地也清空',
  M.mergeStates(st({ checkins: { D: ['a'] }, checkinAt: { D: 100 }, updatedAt: 100 }),
    st({ checkins: {}, checkinAt: { D: 200 }, updatedAt: 200 })).checkins,
  {});

eq('不同日期各自改动 → 都保留',
  M.mergeStates(st({ checkins: { D1: ['a'] }, checkinAt: { D1: 100 }, updatedAt: 100 }),
    st({ checkins: { D2: ['b'] }, checkinAt: { D2: 200 }, updatedAt: 200 })).checkins,
  { D1: ['a'], D2: ['b'] });

eq('老数据（没有 checkinAt）不会丢勾',
  M.mergeStates(st({ checkins: { D: ['a', 'b'] } }),
    st({ checkins: { D: ['a', 'b'] } })).checkins,
  { D: ['a', 'b'] });

console.log('收藏：取消收藏要能传出去');
eq('本地较新（刚取消）→ 以本地为准',
  M.mergeStates(st({ favorites: ['x'], favAt: 300, updatedAt: 300 }),
    st({ favorites: ['x', 'y'], favAt: 100, updatedAt: 100 })).favorites, ['x']);

eq('远端较新（另一台清空）→ 以远端为准',
  M.mergeStates(st({ favorites: ['x', 'y'], favAt: 100, updatedAt: 100 }),
    st({ favorites: [], favAt: 300, updatedAt: 300 })).favorites, []);

eq('两边各收藏一句 → 取较新的那份',
  M.mergeStates(st({ favorites: ['x'], favAt: 100, updatedAt: 100 }),
    st({ favorites: ['y'], favAt: 200, updatedAt: 200 })).favorites, ['y']);

console.log('复盘：删除标记要赢过旧内容');
eq('远端删除标记较新 → 以删除为准',
  M.mergeStates(st({ reviews: { '2026-W43': { t1: 'a', at: 100 } }, updatedAt: 100 }),
    st({ reviews: { '2026-W43': { t1: '', at: 300, del: true } }, updatedAt: 300 }))
    .reviews['2026-W43'].del, true);

eq('本地刚写的复盘较新 → 保留本地',
  M.mergeStates(st({ reviews: { '2026-W43': { t1: '新内容', at: 500 } }, updatedAt: 500 }),
    st({ reviews: { '2026-W43': { t1: '旧内容', at: 100 } }, updatedAt: 100 }))
    .reviews['2026-W43'].t1, '新内容');

console.log('错题：删除墓碑仍然生效');
eq('已删除的错题不会被并回来',
  M.mergeStates(st({ mistakes: [], mkTrash: ['m1'], updatedAt: 300 }),
    st({ mistakes: [{ id: 'm1', title: 't', at: 10, upd: 10 }], updatedAt: 100 })).mistakes, []);

eq('两条不同错题 → 合并保留',
  M.mergeStates(st({ mistakes: [{ id: 'm1', title: '一', at: 10, upd: 10 }], updatedAt: 100 }),
    st({ mistakes: [{ id: 'm2', title: '二', at: 20, upd: 20 }], updatedAt: 200 })).mistakes.length, 2);

console.log('清空数据：较晚的一次整份覆盖');
eq('远端 resetAt 较新 → 采用远端的空状态',
  M.mergeStates(st({ checkins: { D: ['a'] }, updatedAt: 100 }),
    st({ checkins: {}, resetAt: 500, updatedAt: 500 })).checkins, {});

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
