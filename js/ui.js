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
      <div class="upcoming-item ${cls}" style="position: relative; display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; background: var(--md-sys-color-surface-2);">
        <div class="crit-dot" style="position: static;"></div>
        <div style="flex: 1; min-width: 0;">
          <div class="upcoming-title" style="margin: 0 0 4px 0; font-size: 15px;">${escHtml(obl.title)}</div>
          <div class="upcoming-meta" style="margin: 0; justify-content: flex-start; gap: 8px; flex-direction: row; align-items: center;">
            <span class="upcoming-amount">${fmt(obl.amount)}</span>
            <span class="upcoming-day">${dayLabel}</span>
          </div>
        </div>
        <button class="obl-check-btn check-btn" onclick="event.stopPropagation(); toggleUpcomingObligation('${obl.id}', '${escHtml(obl.title)}', ${obl.amount})" title="Отметить оплаченным" style="padding: 8px; font-size: 20px;">✅</button>
      </div>`;
  }).join('');
}

async function toggleUpcomingObligation(id, title, amount) {
  await DB.Obligations.togglePaid(id);
  if (confirm(`Обязательство «${title}» оплачено.\n\nДобавить расход на сумму ${fmt(amount)} прямо сейчас, чтобы баланс сошелся?`)) {
    await DB.Expenses.add({ amount: amount, description: title });
    showToast('Расход добавлен, обязательство оплачено');
  } else {
    showToast('Обязательство оплачено');
  }
  await renderAll();
}

async function renderUpcomingPlanned() {
  const container = document.getElementById('upcoming-planned-list');
  if (!container) return;
  const items = await Calculator.getUpcomingPlannedIncomes(7);

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span>Нет ожидаемых поступлений на ближайшие 7 дней</span>
      </div>`;
    return;
  }

  container.innerHTML = items.map(obl => {
    const dayLabel = obl.days_left === 0 ? 'Сегодня!' :
                     obl.days_left === 1 ? 'Завтра' :
                     `Через ${obl.days_left} дн.`;
    return `
      <div class="upcoming-item medium" style="position: relative; display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; background: var(--md-sys-color-surface-2);">
        <div class="crit-dot" style="position: static; background: var(--md-sys-color-tertiary);"></div>
        <div style="flex: 1; min-width: 0;">
          <div class="upcoming-title" style="margin: 0 0 4px 0; font-size: 15px;">${escHtml(obl.source)}</div>
          <div class="upcoming-meta" style="margin: 0; justify-content: flex-start; gap: 8px; flex-direction: row; align-items: center;">
            <span class="upcoming-amount" style="color: var(--md-sys-color-tertiary);">+${fmt(obl.amount)}</span>
            <span class="upcoming-day">${dayLabel}</span>
          </div>
        </div>
        <button class="obl-check-btn check-btn" onclick="event.stopPropagation(); toggleUpcomingPlanned('${obl.id}', '${escHtml(obl.source)}', ${obl.amount})" title="Отметить полученным" style="padding: 8px; font-size: 20px;">✅</button>
      </div>`;
  }).join('');
}

async function toggleUpcomingPlanned(id, source, amount) {
  await DB.PlannedIncomes.toggleReceived(id);
  if (confirm(`Поступление «${source}» получено.\n\nДобавить доход на сумму ${fmt(amount)} прямо сейчас, чтобы баланс обновился?`)) {
    await DB.Incomes.add({ amount: amount, source: source });
    showToast('Доход добавлен, поступление получено');
  } else {
    showToast('Поступление отмечено полученным');
  }
  await renderAll();
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
      <div class="transaction-item" id="tx-${tx.id}" style="cursor:pointer;" onclick="event.stopPropagation(); ${isIncome ? `editIncome('${tx.id}')` : `editExpense('${tx.id}')`}">
        <div class="tx-icon ${cls}">${icon}</div>
        <div class="tx-info">
          <div class="tx-title">${title}</div>
          <div class="tx-date">${fmtDate(tx.created_at)}</div>
        </div>
        <div class="tx-amount ${cls}">${sign}${fmt(tx.amount)}</div>
        <button class="tx-delete" onclick="event.stopPropagation(); deleteTx('${tx.type}','${tx.id}')" title="Удалить">✕</button>
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
      <div class="obligation-item ${cls}${obl.is_paid ? ' paid' : ''}" id="obl-${obl.id}" style="cursor:pointer;" onclick="editObligation('${obl.id}')">
        <div class="obl-crit"></div>
        <div class="obl-info">
          <div class="obl-title">${escHtml(obl.title)}</div>
          <div class="obl-meta">${critEmoji[obl.criticality]} ${obl.criticality} · ${dayLabel}${paidLabel}</div>
        </div>
        <div class="obl-right">
          <div class="obl-amount">${fmt(obl.amount)}</div>
          <div class="obl-actions">
            <button class="obl-check-btn check-btn" onclick="event.stopPropagation(); toggleObligation('${obl.id}')" title="${paidTitle}">${paidIcon}</button>
            <button class="obl-check-btn delete-btn" onclick="event.stopPropagation(); deleteObligation('${obl.id}')" title="Удалить">✕</button>
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
// PLANNED INCOMES
// ============================================================
async function renderPlanned() {
  const container = document.getElementById('planned-list');
  const items = (await DB.PlannedIncomes.getAll()).sort((a, b) => a.expected_day - b.expected_day);

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⏳</div>
        <p>Нет ожидаемых поступлений.<br>Добавьте планируемый доход.</p>
      </div>`;
    return;
  }

  container.innerHTML = items.map(obl => {
    const daysLeft = Calculator.daysUntilDueDay(obl.expected_day);
    const dayLabel = daysLeft === 0 ? 'Сегодня' :
                     daysLeft === 1 ? 'Завтра' :
                     `${obl.expected_day}-е число (через ${daysLeft} дн.)`;
    const paidLabel = obl.is_received ? ' · ✅ Получено' : '';
    const paidIcon  = obl.is_received ? '↩️' : '✅';
    const paidTitle = obl.is_received ? 'Отметить не полученным' : 'Отметить полученным';

    return `
      <div class="obligation-item medium${obl.is_received ? ' paid' : ''}" id="plan-${obl.id}" style="cursor:pointer;" onclick="editPlanned('${obl.id}')">
        <div class="obl-crit" style="background: var(--md-sys-color-tertiary)"></div>
        <div class="obl-info">
          <div class="obl-title">${escHtml(obl.source)}</div>
          <div class="obl-meta">⏳ Ожидается · ${dayLabel}${paidLabel}</div>
        </div>
        <div class="obl-right">
          <div class="obl-amount" style="color: var(--md-sys-color-tertiary)">+${fmt(obl.amount)}</div>
          <div class="obl-actions">
            <button class="obl-check-btn check-btn" onclick="event.stopPropagation(); togglePlanned('${obl.id}')" title="${paidTitle}">${paidIcon}</button>
            <button class="obl-check-btn delete-btn" onclick="event.stopPropagation(); deletePlanned('${obl.id}')" title="Удалить">✕</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function togglePlanned(id) {
  await DB.PlannedIncomes.toggleReceived(id);
  await renderAll();
  showToast('Статус ожидания обновлён');
}

async function deletePlanned(id) {
  await DB.PlannedIncomes.remove(id);
  await renderAll();
  showToast('Ожидание удалено');
}

// ============================================================
// ANALYTICS (Chart.js)
// ============================================================
let _balanceChart = null;
let _expenseChart = null;

async function renderAnalytics() {
  if (!window.Chart) return;
  const ctxBalance = document.getElementById('balanceChart')?.getContext('2d');
  const ctxExpense = document.getElementById('expenseChart')?.getContext('2d');
  if (!ctxBalance || !ctxExpense) return;

  const [incomes, expenses] = await Promise.all([
    DB.Incomes.getAll(),
    DB.Expenses.getAll()
  ]);

  if (_balanceChart) _balanceChart.destroy();
  if (_expenseChart) _expenseChart.destroy();

  Chart.defaults.color = '#C2C7CE';
  Chart.defaults.font.family = 'Roboto Flex';

  const incTotal = incomes.reduce((s, x) => s + x.amount, 0);
  const expTotal = expenses.reduce((s, x) => s + x.amount, 0);

  _balanceChart = new Chart(ctxBalance, {
    type: 'doughnut',
    data: {
      labels: ['Доходы', 'Расходы'],
      datasets: [{
        data: [incTotal, expTotal],
        backgroundColor: ['#74D7A0', '#FFB4AB'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { title: { display: true, text: 'Соотношение (все время)' } }
    }
  });

  const expGroups = {};
  expenses.forEach(e => {
    const desc = e.description || 'Другое';
    expGroups[desc] = (expGroups[desc] || 0) + e.amount;
  });
  const labels = Object.keys(expGroups);
  const data = Object.values(expGroups);

  _expenseChart = new Chart(ctxExpense, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Расходы (₽)',
        data,
        backgroundColor: '#9ECAFF',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Структура расходов' },
        legend: { display: false }
      }
    }
  });
}

// ============================================================
// GLOBAL RE-RENDER
// Запускает все рендеры параллельно через Promise.all
// ============================================================
async function renderAll() {
  await Promise.all([
    renderTrafficLight(),
    renderUpcoming(),
    renderUpcomingPlanned(),
    renderOperations(),
    renderObligations(),
    renderPlanned(),
    renderAnalytics()
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

// —— ADD & EDIT MODAL HELPERS ——
function openAddObligation() {
  document.getElementById('form-obligation').reset();
  document.getElementById('obl-id').value = '';
  document.getElementById('modal-obligation-title').textContent = 'Добавить обязательство';
  openModal('modal-obligation');
}

async function editObligation(id) {
  const obligations = await DB.Obligations.getAll();
  const obl = obligations.find(o => o.id === id);
  if (!obl) return;
  document.getElementById('form-obligation').reset();
  document.getElementById('obl-id').value = obl.id;
  document.getElementById('obl-title').value = obl.title;
  document.getElementById('obl-amount').value = obl.amount;
  document.getElementById('obl-due-day').value = obl.due_day;
  document.getElementById('obl-criticality').value = obl.criticality;
  document.getElementById('modal-obligation-title').textContent = 'Редактировать обязательство';
  openModal('modal-obligation');
}

function openAddIncome() {
  document.getElementById('form-income').reset();
  document.getElementById('income-id').value = '';
  document.getElementById('modal-income-title').textContent = 'Добавить доход';
  openModal('modal-income');
}

async function editIncome(id) {
  const incomes = await DB.Incomes.getAll();
  const inc = incomes.find(o => o.id === id);
  if (!inc) return;
  document.getElementById('form-income').reset();
  document.getElementById('income-id').value = inc.id;
  document.getElementById('income-amount').value = inc.amount;
  document.getElementById('income-source').value = inc.source;
  document.getElementById('modal-income-title').textContent = 'Редактировать доход';
  openModal('modal-income');
}

function openAddExpense() {
  document.getElementById('form-expense').reset();
  document.getElementById('expense-id').value = '';
  document.getElementById('modal-expense-title').textContent = 'Добавить расход';
  openModal('modal-expense');
}

async function editExpense(id) {
  const expenses = await DB.Expenses.getAll();
  const exp = expenses.find(o => o.id === id);
  if (!exp) return;
  document.getElementById('form-expense').reset();
  document.getElementById('expense-id').value = exp.id;
  document.getElementById('expense-amount').value = exp.amount;
  document.getElementById('expense-desc').value = exp.description;
  document.getElementById('modal-expense-title').textContent = 'Редактировать расход';
  openModal('modal-expense');
}

function openAddPlanned() {
  document.getElementById('form-planned').reset();
  document.getElementById('planned-id').value = '';
  document.getElementById('modal-planned-title').textContent = 'Добавить ожидание';
  openModal('modal-planned');
}

async function editPlanned(id) {
  const items = await DB.PlannedIncomes.getAll();
  const obl = items.find(o => o.id === id);
  if (!obl) return;
  document.getElementById('form-planned').reset();
  document.getElementById('planned-id').value = obl.id;
  document.getElementById('planned-source').value = obl.source;
  document.getElementById('planned-amount').value = obl.amount;
  document.getElementById('planned-day').value = obl.expected_day;
  document.getElementById('modal-planned-title').textContent = 'Редактировать ожидание';
  openModal('modal-planned');
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
