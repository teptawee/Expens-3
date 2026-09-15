/* =========================================================
 * ⚙️ CONFIG — ใส่ API URL ของคุณตรงนี้
 * ========================================================= */
const API_URL = 'https://script.google.com/macros/s/AKfycbyylMb0W0WOwrh4SASFCwEYGc3DdUj4PMSMeECAWAVwOs4wliHtbk5KRHODqXYI4B8PwQ/exec';
const CACHE_TTL = 5 * 60 * 1000; // 5 นาที

/* =========================================================
 * State
 * ========================================================= */
const state = {
  appData: { expenses: [], categories: [], payments: [] },
  dashboard: null,
  monthDashboard: null,
  weekDashboard: null,
  todayDashboard: null,
  yearDashboard: null,
  chart: null,
  comparisonChart: null,
  period: 'day',
  anchor: getTodayISO(),
  currentPage: 'dashboard',
  comparisonCategory: '',
  budgetFilter: 'all',
  expensePage: 1,
  expensePageSize: 10,
  filters: { search: '', date: '', category: '', payment: '' }
};

const $ = s => document.querySelector(s);

// ⭐ รอ Chart.js โหลดเสร็จด้วย (เพราะใช้ defer)
window.addEventListener('DOMContentLoaded', () => {
  if (typeof Chart === 'undefined') {
    // ถ้า Chart ยังไม่มา รออีกนิด
    const t = setInterval(() => {
      if (typeof Chart !== 'undefined') {
        clearInterval(t);
        initApp();
      }
    }, 50);
  } else {
    initApp();
  }
});

/* =========================================================
 * API client
 * ========================================================= */
async function apiCall(action, payload) {
  if (!API_URL || API_URL.includes('YOUR_ID')) {
    throw new Error('กรุณาตั้งค่า API_URL ก่อนใช้งาน');
  }

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload: payload || {} })
  });

  if (!res.ok) throw new Error('เชื่อมต่อ API ไม่สำเร็จ (' + res.status + ')');

  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API Error');
  return json.data;
}

/* =========================================================
 * LocalStorage cache
 * ========================================================= */
function saveCache(key, data) {
  try {
    localStorage.setItem('wallet_' + key, JSON.stringify({
      t: Date.now(),
      d: data
    }));
  } catch (e) {}
}

function loadCache(key) {
  try {
    const raw = localStorage.getItem('wallet_' + key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Date.now() - obj.t > CACHE_TTL) return null;
    return obj.d;
  } catch (e) { return null; }
}

function clearCache() {
  Object.keys(localStorage)
    .filter(k => k.startsWith('wallet_'))
    .forEach(k => localStorage.removeItem(k));
}

/* =========================================================
 * Init & Events
 * ========================================================= */
function initApp() {
  $('#anchorDate').value = state.anchor;
  bindEvents();
  bootstrap();
}

function bindEvents() {
  document.querySelectorAll('.nav-tab, .bottom-nav button').forEach(b => {
    b.addEventListener('click', () => switchPage(b.dataset.page));
  });

  document.querySelectorAll('.period-tab').forEach(b => b.addEventListener('click', () => {
    state.period = b.dataset.period;
    document.querySelectorAll('.period-tab').forEach(x =>
      x.classList.toggle('active', x.dataset.period === state.period));

    const map = {
      day:   state.todayDashboard,
      week:  state.weekDashboard,
      month: state.monthDashboard,
      year:  state.yearDashboard
    };
    state.dashboard = map[state.period];
    renderDashboard();
  }));

  $('#anchorDate').addEventListener('change', e => {
    state.anchor = e.target.value || getTodayISO();
    bootstrap();
  });

  $('#openAddExpenseBtn').addEventListener('click', () => openExpenseModal());
  $('#fabAddExpense').addEventListener('click', () => openExpenseModal());
  $('#openBudgetBtn').addEventListener('click', openBudgetModal);

  $('#comparisonCategoryFilter').addEventListener('change', e => {
    state.comparisonCategory = e.target.value || '';
    renderComparisonChart((state.dashboard && state.dashboard.comparison) || {});
  });

  document.querySelectorAll('.budget-chip').forEach(b => b.addEventListener('click', () => {
    state.budgetFilter = b.dataset.filter;
    document.querySelectorAll('.budget-chip').forEach(x =>
      x.classList.toggle('active', x.dataset.filter === state.budgetFilter));
    renderBudgetSection();
  }));

  $('#searchInput').addEventListener('input', e => {
    state.filters.search = e.target.value;
    state.expensePage = 1;
    renderExpenseList();
  });

  ['filterDate', 'filterCategory', 'filterPayment'].forEach(id => {
    $('#' + id).addEventListener('change', e => {
      state.filters[id.replace('filter', '').toLowerCase()] = e.target.value;
      state.expensePage = 1;
      renderExpenseList();
    });
  });
}

function switchPage(page) {
  state.currentPage = page === 'expenses' ? 'expenses' : 'dashboard';
  document.querySelectorAll('.app-page').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(x =>
    x.classList.toggle('active', x.dataset.page === state.currentPage));
  document.querySelectorAll('.bottom-nav button').forEach(x =>
    x.classList.toggle('active', x.dataset.page === state.currentPage));
  $(state.currentPage === 'dashboard' ? '#pageDashboard' : '#pageExpenses').classList.add('active');

  if (state.currentPage === 'dashboard') {
    setTimeout(() => {
      if (state.chart) state.chart.resize();
      if (state.comparisonChart) state.comparisonChart.resize();
    }, 100);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================
 * Bootstrap
 * ========================================================= */
async function bootstrap() {
  const cacheKey = `boot_${state.period}_${state.anchor}`;
  const cached = loadCache(cacheKey);

  if (cached) {
    applyBootstrap(cached);
  } else {
    showLoading(true);
  }

  try {
    const fresh = await apiCall('getBootstrap', {
      period: state.period,
      anchor: state.anchor
    });
    saveCache(cacheKey, fresh);
    applyBootstrap(fresh);
    showLoading(false);
  } catch (err) {
    showLoading(false);
    if (!cached) handleError(err);
    else showToast('ใช้ข้อมูลที่ cache ไว้ (เชื่อมต่อช้าอยู่)', 'error');
  }
}

function applyBootstrap(data) {
  state.appData = data.appData || { expenses: [], categories: [], payments: [] };

  const d = data.dashboards || {};
  state.todayDashboard = d.day;
  state.weekDashboard  = d.week;
  state.monthDashboard = d.month;
  state.yearDashboard  = d.year;

  state.dashboard = d[state.period] || d.day;

  populateFilterOptions();
  populateComparisonCategoryOptions();
  renderStatCards();
  renderInsights();
  renderDashboard();
  renderBudgetSection();
  renderExpenseList();
}

/* =========================================================
 * Render — Stat Cards
 * ========================================================= */
function renderStatCards() {
  const today = state.todayDashboard || {};
  const week = state.weekDashboard || {};
  const month = state.monthDashboard || {};

  $('#statTodayVal').textContent = formatNumberPlain(today.total);
  renderStatBadge('#statTodayBadge', today.trend, today.total, today.previousTotal);

  $('#statWeekVal').textContent = formatNumberPlain(week.total);
  renderStatBadge('#statWeekBadge', week.trend, week.total, week.previousTotal);

  $('#statMonthVal').textContent = formatNumberPlain(month.total);
  renderStatBadge('#statMonthBadge', month.trend, month.total, month.previousTotal);

  const anchorDate = new Date(state.anchor + 'T12:00:00');
  const now = new Date();
  const isCurrentMonth = anchorDate.getFullYear() === now.getFullYear() &&
                         anchorDate.getMonth() === now.getMonth();
  const dayOfMonth = isCurrentMonth
    ? now.getDate()
    : new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
  const lastDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();

  const avgPerDay = dayOfMonth > 0 ? (month.total || 0) / dayOfMonth : 0;
  const forecast = avgPerDay * lastDay;

  $('#statAvgVal').textContent = formatNumberPlain(avgPerDay);
  $('#statAvgSub').innerHTML = `คาดการณ์สิ้นเดือน ~${formatNumberPlain(forecast)} ฿`;
}

function renderStatBadge(selector, trend, current, previous) {
  const el = $(selector);
  const t = trend || {};
  let dir = t.direction || 'flat';
  let pct = Number(t.percent || 0);

  const cur = Number(current || 0);
  const prev = Number(previous || 0);
  const isNew = prev === 0 && cur > 0;

  el.className = 'stat-badge';
  if (isNew) {
    el.classList.add('new');
    el.textContent = `✨ ใหม่`;
    return;
  }
  if (dir === 'up') {
    el.classList.add('up');
    el.textContent = `▲ +${pct.toFixed(1)}%`;
  } else if (dir === 'down') {
    el.classList.add('down');
    el.textContent = `▼ -${pct.toFixed(1)}%`;
  } else {
    el.classList.add('flat');
    el.textContent = `━ 0%`;
  }
}

/* =========================================================
 * Render — Insights
 * ========================================================= */
function renderInsights() {
  const box = $('#insightList');
  const month = state.monthDashboard || {};
  const byCat = month.byCategory || {};
  const totalMonth = Number(month.total || 0);
  const items = [];

  const catEntries = Object.entries(byCat).filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1]);

  if (catEntries.length && totalMonth > 0) {
    const [topId, topAmount] = catEntries[0];
    const cat = state.appData.categories.find(c => c.id === topId) || { name: 'อื่นๆ', icon: '✨' };
    const pct = (Number(topAmount) / totalMonth) * 100;
    items.push({
      cls: 'fire',
      icon: '🔥',
      html: `หมวด <strong>"${escapeHtml(cat.name)}"</strong> คิดเป็น <span class="num">${pct.toFixed(1)}%</span> ของค่าใช้จ่ายเดือนนี้`
    });

    if (catEntries.length > 1) {
      const [secondId, secondAmount] = catEntries[1];
      const cat2 = state.appData.categories.find(c => c.id === secondId) || { name: 'อื่นๆ' };
      const diff = Number(topAmount) - Number(secondAmount);
      if (diff > 0) {
        items.push({
          cls: 'warn',
          icon: '📊',
          html: `หมวด <strong>"${escapeHtml(cat.name)}"</strong> ใช้มากกว่า <strong>"${escapeHtml(cat2.name)}"</strong> อยู่ <span class="num">${formatNumberPlain(diff)} ฿</span>`
        });
      }
    }
  }

  const cats = state.appData.categories || [];
  const totalBudget = cats.reduce((s, c) => s + Number(c.budget || 0), 0);
  if (totalBudget > 0) {
    const remaining = Math.max(0, totalBudget - totalMonth);
    const pctLeft = totalBudget > 0 ? (remaining / totalBudget) * 100 : 0;
    items.push({
      cls: 'money',
      icon: '💰',
      html: `งบเหลือใช้เดือนนี้รวม <span class="num">${formatNumberPlain(remaining)} บาท</span> (${pctLeft.toFixed(1)}% ของงบทั้งหมด)`
    });
  }

  const anchorDate = new Date(state.anchor + 'T12:00:00');
  const now = new Date();
  const isCurrentMonth = anchorDate.getFullYear() === now.getFullYear() &&
                         anchorDate.getMonth() === now.getMonth();
  const dayOfMonth = isCurrentMonth
    ? now.getDate()
    : new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
  const lastDay = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
  const avgPerDay = dayOfMonth > 0 ? totalMonth / dayOfMonth : 0;
  const forecast = avgPerDay * lastDay;

  if (totalMonth > 0) {
    items.push({
      cls: 'chart',
      icon: '📅',
      html: `คาดการณ์สิ้นเดือน <span class="num">~${formatNumberPlain(forecast)} บาท</span> (จากค่าเฉลี่ย ${formatNumberPlain(avgPerDay)} บาท/วัน)`
    });
  }

  if (!items.length) {
    box.innerHTML = `<div class="insight-item chart"><div class="insight-icon">📭</div><div class="insight-text">ยังไม่มีข้อมูลน่าสนใจ — เริ่มบันทึกรายจ่ายเดือนนี้เพื่อดู insight</div></div>`;
    return;
  }

  box.innerHTML = items.map(it => `
    <div class="insight-item ${it.cls}">
      <div class="insight-icon">${it.icon}</div>
      <div class="insight-text">${it.html}</div>
    </div>
  `).join('');
}

/* =========================================================
 * Render — Dashboard
 * ========================================================= */
function renderDashboard() {
  const d = state.dashboard || {};
  $('#dashboardPeriodText').textContent = `${formatThaiDate(d.from)} - ${formatThaiDate(d.to)}`;
  renderCategoryChart(d.byCategory || {});
  renderTrendCard(d);
  renderComparisonChart(d.comparison || {});
}

function renderCategoryChart(byCategory) {
  const canvas = $('#expenseChart'), empty = $('#chartEmpty'), legend = $('#categoryLegend');
  if (state.chart) state.chart.destroy();
  legend.innerHTML = '';

  const items = Object.entries(byCategory).map(([id, amount]) => {
    const cat = state.appData.categories.find(x => x.id === id) ||
      { name: 'อื่นๆ', icon: '✨', color: '#c7b9ff' };
    return { ...cat, amount: Number(amount || 0) };
  }).filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);

  if (!items.length) {
    canvas.classList.add('hidden');
    empty.classList.remove('hidden');
    legend.innerHTML = '<div style="color:#8a83a8">ไม่มีรายการในช่วงเวลานี้</div>';
    return;
  }
  canvas.classList.remove('hidden');
  empty.classList.add('hidden');

  state.chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: items.map(x => x.name),
      datasets: [{
        data: items.map(x => x.amount),
        backgroundColor: items.map(x => x.color || '#c7b9ff'),
        borderColor: 'rgba(255,255,255,.9)',
        borderWidth: 4,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true, cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(58,50,96,.9)',
          padding: 12, cornerRadius: 12,
          titleFont: { family: 'Prompt', size: 13 },
          bodyFont: { family: 'Prompt', size: 12 },
          callbacks: { label: c => `${c.label}: ${formatCurrency(c.raw)}` }
        }
      }
    }
  });

  items.forEach(x => {
    legend.insertAdjacentHTML('beforeend', `
      <div class="legend-row">
        <div class="legend-left"><span class="color-dot" style="background:${escapeHtml(x.color)}"></span><span class="legend-name">${escapeHtml(x.icon)} ${escapeHtml(x.name)}</span></div>
        <span class="legend-amount">${formatCurrency(x.amount)}</span>
      </div>
    `);
  });
}

function renderTrendCard(d) {
  const t = d.trend || { percent: 0, direction: 'flat', label: 'เท่ากับช่วงก่อนหน้า' };
  const card = $('#trendCard');
  card.className = `trend-card ${t.direction || 'flat'}`;
  $('#trendIcon').textContent = t.direction === 'up' ? '▲' : t.direction === 'down' ? '▼' : '━';
  $('#trendTitle').textContent = t.label || 'เปรียบเทียบกับช่วงก่อนหน้า';
  $('#trendValue').textContent = `${Number(t.percent || 0).toFixed(1)}%`;
  $('#trendDetail').textContent = `ช่วงก่อนหน้า: ${formatCurrency(d.previousTotal || 0)} (${formatThaiDate(d.previousFrom)} - ${formatThaiDate(d.previousTo)})`;
}

function renderComparisonChart(comparison) {
  const canvas = $('#comparisonChart');
  if (state.comparisonChart) state.comparisonChart.destroy();

  const labelsMap = {
    day: 'เปรียบเทียบค่าใช้จ่ายรายวันย้อนหลัง 7 วัน',
    week: 'เปรียบเทียบค่าใช้จ่ายรายสัปดาห์ย้อนหลัง 8 สัปดาห์',
    month: 'เปรียบเทียบค่าใช้จ่ายรายเดือนย้อนหลัง 12 เดือน',
    year: 'เปรียบเทียบค่าใช้จ่ายรายปีย้อนหลัง 5 ปี'
  };

  const categories = state.appData.categories || [];
  const categorySeries = comparison.categorySeries || {};
  const selectedId = state.comparisonCategory || '';
  const selected = selectedId ? categories.find(x => x.id === selectedId) : null;

  $('#comparisonChartText').textContent = selected
    ? `${labelsMap[state.period]} • ${selected.icon} ${selected.name}`
    : (labelsMap[state.period] || 'เปรียบเทียบค่าใช้จ่าย');

  const datasets = [{
    type: 'bar', label: 'ค่าใช้จ่ายรวม',
    data: comparison.values || [],
    backgroundColor: 'rgba(169,155,255,.28)',
    borderColor: '#a99bff', borderWidth: 1.5,
    borderRadius: 10, maxBarThickness: 46, order: 2
  }];

  let lines = Object.entries(categorySeries).map(([id, values]) => {
    const cat = categories.find(x => x.id === id) || { id, name: 'อื่นๆ', icon: '✨', color: '#c7b9ff' };
    return { id, cat, values, total: values.reduce((s, v) => s + Number(v || 0), 0) };
  }).filter(x => x.total > 0).sort((a, b) => b.total - a.total);

  if (selectedId) lines = lines.filter(x => x.id === selectedId);

  lines.forEach(x => datasets.push({
    type: 'line',
    label: `${x.cat.icon || '✨'} ${x.cat.name || 'อื่นๆ'}`,
    data: x.values,
    borderColor: x.cat.color || '#c7b9ff',
    backgroundColor: x.cat.color || '#c7b9ff',
    borderWidth: 3, pointRadius: 4, pointHoverRadius: 7,
    pointBackgroundColor: '#fff', pointBorderWidth: 2.5,
    tension: .38, fill: false, order: 1
  }));

  state.comparisonChart = new Chart(canvas, {
    data: { labels: comparison.labels || [], datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: { usePointStyle: true, pointStyle: 'circle', padding: 14, font: { family: 'Prompt', size: 11.5 }, color: '#8a83a8' }
        },
        tooltip: {
          backgroundColor: 'rgba(58,50,96,.9)',
          padding: 12, cornerRadius: 12,
          titleFont: { family: 'Prompt', size: 13 },
          bodyFont: { family: 'Prompt', size: 12 },
          callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.raw)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0, color: '#8a83a8', font: { family: 'Prompt', size: 11 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(199,185,255,.15)' }, ticks: { callback: v => formatCompactCurrency(v), color: '#8a83a8', font: { family: 'Prompt', size: 11 } } }
      }
    }
  });
}

/* =========================================================
 * Render — Budget
 * ========================================================= */
function renderBudgetSection() {
  const box = $('#budgetList');
  const banner = $('#budgetBanner');
  const filtersBox = $('#budgetFilters');
  const spending = (state.monthDashboard && state.monthDashboard.byCategory) || {};

  const allItems = (state.appData.categories || [])
    .map(c => {
      const budget = Number(c.budget || 0);
      const spent = Number(spending[c.id] || 0);
      const remaining = Math.max(0, budget - spent);
      const pct = budget > 0 ? (spent / budget) * 100 : 0;
      return { ...c, budget, spent, remaining, pct };
    })
    .filter(c => c.budget > 0 || c.spent > 0)
    .sort((a, b) => {
      if (a.budget > 0 && b.budget > 0) return b.pct - a.pct;
      if (a.budget > 0) return -1;
      if (b.budget > 0) return 1;
      return b.spent - a.spent;
    });

  const totalBudget = allItems.reduce((s, c) => s + c.budget, 0);
  const totalSpent = allItems.reduce((s, c) => s + c.spent, 0);
  const overallPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  const now = new Date(state.anchor + 'T12:00:00');
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, lastDay - now.getDate());

  const statusText = overallPct < 50 ? 'อยู่ในเกณฑ์ดี'
    : overallPct < 80 ? 'เฝ้าระวัง'
    : overallPct < 100 ? 'ใกล้เต็มงบ'
    : 'เกินงบแล้ว';
  const statusEmoji = overallPct < 50 ? '🎉'
    : overallPct < 80 ? '⚡'
    : overallPct < 100 ? '⚠️'
    : '🔥';

  if (!allItems.length) {
    banner.classList.add('hidden');
    filtersBox.classList.add('hidden');
    box.innerHTML = `<div class="budget-empty"><div class="empty-icon">🎯</div><h3 style="margin:0 0 4px;color:var(--text)">ยังไม่ได้ตั้งงบประมาณ</h3><div>กดปุ่ม "ตั้งงบประมาณ" เพื่อเริ่มวางแผนรายจ่าย</div></div>`;
    return;
  }

  banner.classList.remove('hidden');
  filtersBox.classList.remove('hidden');

  banner.innerHTML = `
    <div class="budget-banner-left">
      <span class="emoji-lg">🐷</span>
      <span>${statusEmoji}</span>
      <span>${statusText} • เหลืออีก ${daysLeft} วัน</span>
    </div>
    <div class="budget-banner-right">
      <strong>${formatCurrency(totalSpent)}</strong>
      <span class="muted">/ ${formatCurrency(totalBudget)}</span>
      <span class="pct">(${overallPct.toFixed(1)}%)</span>
    </div>
  `;

  let items = allItems;
  if (state.budgetFilter === 'warning') items = allItems.filter(c => c.pct >= 80 && c.pct < 100);
  if (state.budgetFilter === 'danger')  items = allItems.filter(c => c.pct >= 100);

  if (!items.length) {
    box.innerHTML = `<div class="budget-empty" style="grid-column:1/-1">ไม่มีหมวดที่ตรงกับตัวกรอง</div>`;
    return;
  }

  const colorPalette = ['', 'mint', 'peach', 'pink', 'lav', 'blue', 'sand'];

  box.innerHTML = items.map((c, i) => {
    const isOver = c.pct >= 100;
    const isWarn = c.pct >= 80 && c.pct < 100;
    const status = isOver ? 'danger' : isWarn ? 'warning' : 'safe';
    const colorClass = colorPalette[i % colorPalette.length];
    const remainPct = c.budget > 0 ? Math.max(0, 100 - c.pct) : 0;
    const displayPct = c.budget > 0 ? c.pct.toFixed(1) : '—';
    const subText = isOver
      ? `เกินงบ ${formatCurrencyShort(c.spent - c.budget)}`
      : `คงเหลือ ${Math.round(remainPct)}%`;

    return `
      <div class="budget-item ${status}">
        <div class="budget-item-head">
          <div class="budget-item-title">
            <div class="budget-icon-box ${colorClass}">${escapeHtml(c.icon || '✨')}</div>
            <div style="min-width:0">
              <div class="budget-name">${escapeHtml(c.name)}</div>
              <div class="budget-sub">${subText}</div>
            </div>
          </div>
          <div class="budget-pct">${displayPct}%</div>
        </div>
        <div class="budget-stats">
          <div class="budget-stat stat-spent">
            <div class="bs-label">💸 ใช้ไป</div>
            <div class="bs-value">${formatCurrencyShort(c.spent)}</div>
          </div>
          <div class="budget-stat stat-budget">
            <div class="bs-label">🎯 วงเงิน</div>
            <div class="bs-value">${formatCurrencyShort(c.budget)}</div>
          </div>
          <div class="budget-stat stat-left ${c.remaining <= 0 && c.budget > 0 ? 'neg' : ''}">
            <div class="bs-label">🔥 คงเหลือ</div>
            <div class="bs-value">${formatCurrencyShort(c.remaining)}</div>
          </div>
        </div>
        <div class="progress"><div style="width:${Math.min(c.pct, 100)}%"></div></div>
      </div>
    `;
  }).join('');
}

/* =========================================================
 * Filters
 * ========================================================= */
function populateFilterOptions() {
  const c = state.filters.category, p = state.filters.payment;
  $('#filterCategory').innerHTML = `<option value="">ทุกหมวดหมู่</option>${state.appData.categories.map(x => `<option value="${escapeAttribute(x.id)}">${escapeHtml(x.icon)} ${escapeHtml(x.name)}</option>`).join('')}`;
  $('#filterPayment').innerHTML = `<option value="">ทุกช่องทางชำระ</option>${state.appData.payments.map(x => `<option value="${escapeAttribute(x.id)}">${escapeHtml(x.icon)} ${escapeHtml(x.name)}</option>`).join('')}`;
  $('#filterCategory').value = c;
  $('#filterPayment').value = p;
}

function populateComparisonCategoryOptions() {
  const select = $('#comparisonCategoryFilter');
  const old = state.comparisonCategory || '';
  select.innerHTML = `<option value="">ทุกหมวดหมู่</option>${state.appData.categories.map(x => `<option value="${escapeAttribute(x.id)}">${escapeHtml(x.icon)} ${escapeHtml(x.name)}</option>`).join('')}`;
  state.comparisonCategory = [...select.options].some(x => x.value === old) ? old : '';
  select.value = state.comparisonCategory;
}

/* =========================================================
 * Render — Expense List
 * ========================================================= */
/* =========================================================
 * Render — Expense List (จัดกลุ่มตามวันที่)
 * ========================================================= */
function renderExpenseList() {
  const box = $('#expenseTableContainer');
  const cats = state.appData.categories || [];
  const pays = state.appData.payments || [];

  const rowsData = [...(state.appData.expenses || [])]
    .filter(x => matchesFilters(x, cats, pays))
    .sort((a, b) => {
      const diff = new Date(`${b.date}T12:00:00`) - new Date(`${a.date}T12:00:00`);
      return diff || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

  const total = rowsData.length;
  const size = Number(state.expensePageSize) || 10;
  const pages = Math.max(1, Math.ceil(total / size));
  if (state.expensePage > pages) state.expensePage = pages;

  const start = (state.expensePage - 1) * size;
  const end = Math.min(start + size, total);
  const data = rowsData.slice(start, end);

  $('#expenseCountText').textContent = `ทั้งหมด ${total.toLocaleString('th-TH')} รายการ`;

  if (!total) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">🧾</div><h3>ยังไม่มีรายการค่าใช้จ่าย</h3><div>เริ่มบันทึกรายจ่ายของคุณเพื่อดูภาพรวมทางการเงิน</div><button class="btn btn-primary" style="margin-top:16px" onclick="openExpenseModal()">＋ เพิ่มค่าใช้จ่าย</button></div>`;
    return;
  }

  // ⭐ จัดกลุ่มตามวันที่
  const groups = groupByDate(data, cats, pays);

  const groupsHtml = groups.map(g => {
    const itemsHtml = g.items.map(x => {
      const c = cats.find(i => i.id === x.category) || { name: 'อื่นๆ', icon: '✨' };
      const p = pays.find(i => i.id === x.payment) || { name: 'ไม่ระบุ', icon: '💳' };
      return `
        <div class="expense-row">
          <div class="expense-row-icon">${escapeHtml(c.icon)}</div>
          <div class="expense-row-main">
            <div class="expense-row-title">${escapeHtml(x.item || '-')}</div>
            <div class="expense-row-meta">
              <span class="meta-tag">${escapeHtml(c.name)}</span>
              <span class="meta-tag">${escapeHtml(p.icon)} ${escapeHtml(p.name)}</span>
              ${x.note ? `<span class="meta-note" title="${escapeAttribute(x.note)}">📝 ${escapeHtml(x.note)}</span>` : ''}
            </div>
          </div>
          <div class="expense-row-amount">${formatCurrency(x.amount)}</div>
          <div class="expense-row-actions">
            <button class="icon-btn" type="button" onclick="editExpense('${escapeAttribute(x.id)}')" title="แก้ไข">✏️</button>
            <button class="icon-btn" type="button" onclick="confirmDeleteExpense('${escapeAttribute(x.id)}')" title="ลบ">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    const dayLabel = formatThaiDateFull(g.date);
    const isToday = g.date === getTodayISO();
    const isYesterday = (() => {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return new Date(y.getTime() - y.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    })();

    const badge = isToday
      ? `<span class="date-badge today">วันนี้</span>`
      : isYesterday
      ? `<span class="date-badge yesterday">เมื่อวาน</span>`
      : '';

    return `
      <div class="expense-group">
        <div class="expense-group-header">
          <div class="date-info">
            <span class="date-emoji">📅</span>
            <div>
              <div class="date-label">${escapeHtml(dayLabel)}</div>
              <div class="date-sub">${g.items.length} รายการ</div>
            </div>
            ${badge}
          </div>
          <div class="date-total">
            <span class="date-total-label">รวม</span>
            <span class="date-total-value">${formatCurrency(g.total)}</span>
          </div>
        </div>
        <div class="expense-group-body">${itemsHtml}</div>
      </div>
    `;
  }).join('');

  box.innerHTML = `
    <div class="expense-groups">${groupsHtml}</div>
    <div class="pagination-bar">
      <div class="pagination-info">แสดง ${start + 1}-${end} จาก ${total.toLocaleString('th-TH')} รายการ</div>
      <div class="pagination-actions">
        <label class="page-size-wrap">แสดง <select id="pageSizeSelect" class="page-size-select">
          ${[10, 20, 50, 100].map(x => `<option value="${x}" ${size === x ? 'selected' : ''}>${x}</option>`).join('')}
        </select> รายการ</label>
        <button id="prevPageBtn" class="page-btn" ${state.expensePage <= 1 ? 'disabled' : ''}>‹</button>
        <span class="page-number">หน้า ${state.expensePage} / ${pages}</span>
        <button id="nextPageBtn" class="page-btn" ${state.expensePage >= pages ? 'disabled' : ''}>›</button>
      </div>
    </div>`;

  $('#pageSizeSelect').addEventListener('change', e => {
    state.expensePageSize = Number(e.target.value);
    state.expensePage = 1;
    renderExpenseList();
  });
  $('#prevPageBtn').addEventListener('click', () => {
    if (state.expensePage > 1) { state.expensePage--; renderExpenseList(); }
  });
  $('#nextPageBtn').addEventListener('click', () => {
    if (state.expensePage < pages) { state.expensePage++; renderExpenseList(); }
  });
}

/** จัดกลุ่มรายการตามวันที่ */
function groupByDate(items) {
  const map = new Map();
  items.forEach(x => {
    const key = x.date || 'unknown';
    if (!map.has(key)) map.set(key, { date: key, items: [], total: 0 });
    const g = map.get(key);
    g.items.push(x);
    g.total += Number(x.amount || 0);
  });
  // เรียงวันที่ใหม่ → เก่า
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}
/* =========================================================
 * Modal — Expense
 * ========================================================= */
function openExpenseModal(expense) {
  const x = expense || {};
  const cats = state.appData.categories || [];
  const pays = state.appData.payments || [];

  $('#modalContainer').innerHTML = `
    <div id="expenseBackdrop" class="modal-backdrop"><div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>${expense ? 'แก้ไขรายการค่าใช้จ่าย' : 'เพิ่มค่าใช้จ่าย'}</h3><button class="close-btn" type="button" onclick="closeModal()">×</button></div>
      <form id="expenseForm"><div class="modal-body">
        <input id="expenseId" type="hidden" value="${escapeAttribute(x.id || '')}">
        <div class="form-grid">
          <div class="field"><label>วันที่ *</label><input id="expenseDate" type="date" required value="${escapeAttribute(x.date || getTodayISO())}"></div>
          <div class="field"><label>จำนวนเงิน *</label><input id="expenseAmount" type="number" min="0.01" step="0.01" required value="${escapeAttribute(x.amount || '')}"></div>
          <div class="field full"><label>รายการ *</label><input id="expenseItem" type="text" maxlength="150" required placeholder="เช่น อาหารกลางวัน" value="${escapeAttribute(x.item || '')}"></div>
          <div class="field"><label>หมวดหมู่</label><select id="expenseCategory">${cats.map(c => `<option value="${escapeAttribute(c.id)}" ${x.category === c.id ? 'selected' : ''}>${escapeHtml(c.icon)} ${escapeHtml(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>ช่องทางชำระเงิน</label><select id="expensePayment">${pays.map(p => `<option value="${escapeAttribute(p.id)}" ${x.payment === p.id ? 'selected' : ''}>${escapeHtml(p.icon)} ${escapeHtml(p.name)}</option>`).join('')}</select></div>
          <div class="field full"><label>หมายเหตุ</label><textarea id="expenseNote" maxlength="500">${escapeHtml(x.note || '')}</textarea></div>
        </div>
      </div><div class="modal-footer"><button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button><button id="saveExpenseBtn" class="btn btn-primary">บันทึกรายการ</button></div></form>
    </div></div>`;

  $('#expenseBackdrop').addEventListener('click', closeModal);
  $('#expenseForm').addEventListener('submit', saveExpenseForm);
  setTimeout(() => $('#expenseItem').focus(), 100);
}

async function saveExpenseForm(e) {
  e.preventDefault();
  const item = $('#expenseItem').value.trim();
  const amount = Number($('#expenseAmount').value);
  if (!item) return showToast('กรุณากรอกชื่อรายการ', 'error');
  if (!amount || amount <= 0) return showToast('กรุณากรอกจำนวนเงินให้ถูกต้อง', 'error');

  const btn = $('#saveExpenseBtn');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';

  try {
    const data = await apiCall('saveExpense', {
      id: $('#expenseId').value || '',
      date: $('#expenseDate').value,
      item, amount,
      category: $('#expenseCategory').value,
      payment: $('#expensePayment').value,
      note: $('#expenseNote').value.trim()
    });

    state.appData = data;
    state.expensePage = 1;
    populateFilterOptions();
    populateComparisonCategoryOptions();
    closeModal();
    clearCache();
    await bootstrap();
    showToast('บันทึกรายการเรียบร้อยแล้ว');
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'บันทึกรายการ';
    handleError(err);
  }
}

function editExpense(id) {
  const x = state.appData.expenses.find(i => i.id === id);
  if (!x) return showToast('ไม่พบรายการที่ต้องการแก้ไข', 'error');
  openExpenseModal(x);
}

function confirmDeleteExpense(id) {
  const x = state.appData.expenses.find(i => i.id === id);
  if (!x) return showToast('ไม่พบรายการที่ต้องการลบ', 'error');

  $('#modalContainer').innerHTML = `
    <div id="deleteBackdrop" class="modal-backdrop"><div class="modal" style="max-width:430px" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>ยืนยันการลบ</h3><button class="close-btn" onclick="closeModal()">×</button></div>
      <div class="modal-body"><p style="margin:0">ต้องการลบรายการ <strong>${escapeHtml(x.item)}</strong> ใช่หรือไม่?</p><p style="color:#8a83a8;font-size:12px;margin-top:8px">เมื่อลบแล้วจะไม่สามารถกู้คืนรายการนี้ได้</p></div>
      <div class="modal-footer"><button class="btn btn-outline" onclick="closeModal()">ยกเลิก</button><button id="confirmDeleteBtn" class="btn btn-danger">ลบรายการ</button></div>
    </div></div>`;

  $('#deleteBackdrop').addEventListener('click', closeModal);
  $('#confirmDeleteBtn').addEventListener('click', async () => {
    const btn = $('#confirmDeleteBtn');
    btn.disabled = true;
    btn.textContent = 'กำลังลบ...';
    try {
      const data = await apiCall('deleteExpense', { id });
      state.appData = data;
      populateFilterOptions();
      populateComparisonCategoryOptions();
      closeModal();
      clearCache();
      await bootstrap();
      showToast('ลบรายการเรียบร้อยแล้ว');
    } catch (err) {
      handleError(err);
    }
  });
}

/* =========================================================
 * Modal — Budget
 * ========================================================= */
function openBudgetModal() {
  const cats = state.appData.categories || [];

  $('#modalContainer').innerHTML = `
    <div id="budgetBackdrop" class="modal-backdrop"><div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header"><h3>ตั้งงบประมาณรายหมวดหมู่</h3><button class="close-btn" onclick="closeModal()">×</button></div>
      <form id="budgetForm"><div class="modal-body">
        <p style="margin-top:0;color:#8a83a8;font-size:12px">กำหนดงบต่อเดือนเป็นเงินบาท โดยใส่ 0 หากไม่ต้องการตั้งงบ</p>
        <div class="budget-form-list">${cats.map(c => `<label class="budget-form-row"><span>${escapeHtml(c.icon)} ${escapeHtml(c.name)}</span><input type="number" min="0" step="1" data-budget-id="${escapeAttribute(c.id)}" value="${Number(c.budget || 0)}"></label>`).join('')}</div>
      </div><div class="modal-footer"><button type="button" class="btn btn-outline" onclick="closeModal()">ยกเลิก</button><button id="saveBudgetBtn" class="btn btn-primary">บันทึกงบประมาณ</button></div></form>
    </div></div>`;

  $('#budgetBackdrop').addEventListener('click', closeModal);
  $('#budgetForm').addEventListener('submit', async e => {
    e.preventDefault();
    const budgets = {};
    document.querySelectorAll('[data-budget-id]').forEach(i => {
      budgets[i.dataset.budgetId] = Math.max(0, Number(i.value) || 0);
    });

    const btn = $('#saveBudgetBtn');
    btn.disabled = true;
    btn.textContent = 'กำลังบันทึก...';

    try {
      const data = await apiCall('saveCategoryBudgets', { budgets });
      state.appData = data;
      closeModal();
      clearCache();
      await bootstrap();
      showToast('บันทึกงบประมาณเรียบร้อยแล้ว');
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'บันทึกงบประมาณ';
      handleError(err);
    }
  });
}

/* =========================================================
 * Utils
 * ========================================================= */
function closeModal() { $('#modalContainer').innerHTML = ''; }
function showLoading(show) { $('#loadingScreen').classList.toggle('hidden', !show); }

function showToast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function handleError(err) {
  showLoading(false);
  console.error(err);
  showToast((err && err.message) || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง', 'error');
}

function formatCurrency(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('th-TH', {
    style: 'currency', currency: 'THB',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(Number.isFinite(n) ? n : 0);
}
function formatNumberPlain(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
}
function formatCurrencyShort(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `฿${(n / 1000000).toFixed(1)}M`;
  if (n >= 10000) return `฿${(n / 1000).toFixed(1)}K`;
  return `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;
}
function formatCompactCurrency(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `฿${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `฿${(n / 1000).toFixed(1)}K`;
  return `฿${n.toLocaleString('th-TH')}`;
}
function formatThaiDate(value) {
  if (!value) return '-';
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);

  function formatThaiDateFull(value) {
  if (!value) return '-';
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '-';
  const days = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const dayName = days[d.getDay()];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear() + 543;
  return `${dayName}ที่ ${day} ${month} ${year}`;
}
}
function getTodayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function escapeAttribute(value) { return escapeHtml(value); }

/* ⭐ เปิดให้ onclick="..." ใน HTML เข้าถึงได้ */
window.openExpenseModal = openExpenseModal;
window.closeModal = closeModal;
window.editExpense = editExpense;
window.confirmDeleteExpense = confirmDeleteExpense;
