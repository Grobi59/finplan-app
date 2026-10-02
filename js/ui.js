/**
 * ui.js — Async UI rendering
 * Все render-функции теперь async (ждут данных от DB)
 */

// ——— Formatting ———
function fmt(amount) {
  return new Intl.NumberFormat('ru-RU', {
    style:                 'currency',
    currency:              'RUB',
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(isoString) {
  return new Date(isoString).toLocaleString('ru-RU', {
    day:    '2-digit',
    month:  'short',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

// ——— Header date ———
function renderHeaderDate() {
  const el = document.getElementById('header-date-text');
  if (!el) return;
  
  const dateStr = new Date().toLocaleDateString('ru-RU', {
    weekday: 'short',
    day:     'numeric',
    month:   'long',
  });
  
  const icon = DB.isCloudStorage ? '☁️' : '📱';
  el.textContent = `${icon} ${dateStr}`;
}

async function forceSync() {
  showToast('🔄 Синхронизация с облаком...');
  await renderAll();
  showToast('✅ Данные обновлены');
}

// ——— Animated counter ———
function animateValue(el, target, formatter) {
  const duration = 500;
  const startTs  = performance.now();

  function tick(now) {
    const elapsed  = now - startTs;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = formatter(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ——— Escape HTML ———
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// TRAFFIC LIGHT
// ============================================================
async function renderTrafficLight() {
  const balance = await Calculator.compute();
  const status  = Calculator.getStatus(balance);

  const tl        = document.getElementById('traffic-light');
  const tlAmount  = document.getElementById('tl-amount');
  const tlStatus  = document.getElementById('tl-status');
  const metCash   = document.getElementById('metric-cash-val');
  const metFrozen = document.getElementById('metric-frozen-val');
  const metFree   = document.getElementById('metric-free-val');
  const metObl    = document.getElementById('metric-obligations-val');

  tl.classList.remove('green', 'yellow', 'red');
  tl.classList.add(status.state);

  animateValue(tlAmount, balance.today_limit, fmt);
  tlStatus.textContent = status.label;

  metCash.textContent   = fmt(balance.current_cash);
  metFrozen.textContent = fmt(balance.frozen_funds);
  metFree.textContent   = fmt(balance.free_balance);

  // Obligations count (async)
  const obligations = await DB.Obligations.getAll();
  metObl.textContent = obligations.filter(o => !o.is_paid).length;
}

// ============================================================
// UPCOMING OBLIGATIONS (on home tab)
// ============================================================
async function renderUpcoming() {
  const container = document.getElementById('upcoming-list');
  const items     = await Calculator.getUpcomingObligations(7);

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span>Нет обязательств на ближайшие 7 дней 🎉</span>
      </div>`;
    return;
  }

  const critClass = { 'Высокая': 'high', 'Средняя': 'medium', 'Низкая': 'low' };

  container.innerHTML = items.map(obl => {
    const cls      = critClass[obl.criticality] || 'medium';
    const dayLabel = obl.days_left === 0 ? 'Сегодня!' :
                     obl.days_left === 1 ? 'Завтра' :
                     `Через ${obl.days_left} дн.`;
    return `
      <div class="upcoming-item ${cls}">
        <div class="crit-dot"></div>
        <span class="upcoming-title">${escHtml(obl.title)}</span>
        <div class="upcoming-meta">
          <span class="upcoming-amount">${fmt(obl.amount)}</span>
          <span class="upcoming-day">${dayLabel}</span>
        </div>
      </div>`;
  }).join('');
}

// ============================================================
// OPERATIONS LIST
// ============================================================
let _currentFilter = 'all';

async function renderOperations(filter = _currentFilter) {
  _currentFilter = filter;
  const container = document.getElementById('operations-list');

  const [incomes, expenses] = await Promise.all([
    DB.Incomes.getAll(),
    DB.Expenses.getAll(),
  ]);

  let all = [
    ...incomes.map(x => ({ ...x, type: 'income' })),
    ...expenses.map(x => ({ ...x, type: 'expense' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (filter === 'income')  all = all.filter(x => x.type === 'income');
  if (filter === 'expense') all = all.filter(x => x.type === 'expense');

  if (!all.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <p>Операций пока нет.<br>Добавьте доход или расход.</p>
      </div>`;
    return;
  }

  container.innerHTML = all.map(tx => {
    const isIncome = tx.type === 'income';
    const icon     = isIncome ? '⬆️' : '⬇️';
    const title    = isIncome ? escHtml(tx.source || 'Доход') : escHtml(tx.description || 'Расход');
    const sign     = isIncome ? '+' : '−';
    const cls      = isIncome ? 'income' : 'expense';

    return `
      <div class="transaction-item" id="tx-${tx.id}">
        <div class="tx-icon ${cls}">${icon}</div>
        <div class="tx-info">
          <div class="tx-title">${title}</div>
          <div class="tx-date">${fmtDate(tx.created_at)}</div>
        </div>
        <div class="tx-amount ${cls}">${sign}${fmt(tx.amount)}</div>
        <button class="tx-delete" onclick="deleteTx('${tx.type}','${tx.id}')" title="Удалить">✕</button>
      </div>`;
  }).join('');
}

function filterOperations(filter, btn) {
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderOperations(filter);
}

async function deleteTx(type, id) {
  if (type === 'income') await DB.Incomes.remove(id);
  else await DB.Expenses.remove(id);
  await renderAll();
  showToast('Операция удалена');
}

// ============================================================
// OBLIGATIONS LIST
// ============================================================
async function renderObligations() {
  const container   = document.getElementById('obligations-list');
  const obligations = (await DB.Obligations.getAll()).sort((a, b) => a.due_day - b.due_day);

  if (!obligations.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔥</div>
        <p>Горящих точек нет.<br>Добавьте обязательные расходы.</p>
      </div>`;
    return;
  }

  const critClass = { 'Высокая': 'high', 'Средняя': 'medium', 'Низкая': 'low' };
  const critEmoji = { 'Высокая': '🔴', 'Средняя': '🟡', 'Низкая': '🟢' };

  container.innerHTML = obligations.map(obl => {
    const cls      = critClass[obl.criticality] || 'medium';
    const daysLeft = Calculator.daysUntilDueDay(obl.due_day);
    const dayLabel = daysLeft === 0 ? 'Сегодня' :
                     daysLeft === 1 ? 'Завтра' :
                     `${obl.due_day}-е число (через ${daysLeft} дн.)`;
    const paidLabel = obl.is_paid ? ' · ✅ Оплачено' : '';
    const paidIcon  = obl.is_paid ? '↩️' : '✅';
    const paidTitle = obl.is_paid ? 'Отметить неоплаченным' : 'Отметить оплаченным';

    return `
      <div class="obligation-item ${cls}${obl.is_paid ? ' paid' : ''}" id="obl-${obl.id}">
        <div class="obl-crit"></div>
        <div class="obl-info">
          <div class="obl-title">${escHtml(obl.title)}</div>
          <div class="obl-meta">${critEmoji[obl.criticality]} ${obl.criticality} · ${dayLabel}${paidLabel}</div>
        </div>
        <div class="obl-right">
          <div class="obl-amount">${fmt(obl.amount)}</div>
          <div class="obl-actions">
            <button class="obl-check-btn check-btn" onclick="toggleObligation('${obl.id}')" title="${paidTitle}">${paidIcon}</button>
            <button class="obl-check-btn delete-btn" onclick="deleteObligation('${obl.id}')" title="Удалить">✕</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function toggleObligation(id) {
  await DB.Obligations.togglePaid(id);
  await renderAll();
  showToast('Статус обязательства обновлён');
}

async function deleteObligation(id) {
  await DB.Obligations.remove(id);
  await renderAll();
  showToast('Обязательство удалено');
}

// ============================================================
// GLOBAL RE-RENDER
// Запускает все рендеры параллельно через Promise.all
// ============================================================
async function renderAll() {
  await Promise.all([
    renderTrafficLight(),
    renderUpcoming(),
    renderOperations(),
    renderObligations(),
  ]);
}

// ============================================================
// MODAL HELPERS
// ============================================================
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  document.body.style.overflow = '';
}

function closeModalOnOverlay(event, id) {
  if (event.target === document.getElementById(id)) closeModal(id);
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(tabName, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tabName}`)?.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');

  document.getElementById(`tab-${tabName}`)?.scrollTo(0, 0);
}

// ============================================================
// TOAST / SNACKBAR
// ============================================================
let _toastTimer = null;

function showToast(msg, duration = 2400) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}
