/**
 * calculator.js — Бизнес-логика (async)
 * Все методы async — ждут данных от DB
 */

const Calculator = (() => {

  const HORIZON_DAYS  = 7;
  const FREEZE_WINDOW = 14;

  /** Дней до наступления due_day (0 = сегодня) */
  function daysUntilDueDay(dueDay) {
    const today      = new Date();
    const todayDay   = today.getDate();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    if (dueDay >= todayDay) return dueDay - todayDay;
    return (daysInMonth - todayDay) + dueDay;
  }

  /**
   * Основной расчёт баланса.
   * Возвращает Promise<BalanceObject>
   */
  async function compute() {
    const [incomes, expenses, obligations] = await Promise.all([
      DB.Incomes.getAll(),
      DB.Expenses.getAll(),
      DB.Obligations.getAll(),
    ]);

    // 1. Текущий кэш
    const totalIncome  = incomes.reduce((s, x) => s + x.amount, 0);
    const totalExpense = expenses.reduce((s, x) => s + x.amount, 0);
    const current_cash = totalIncome - totalExpense;

    // 2. Замороженные средства (Высокая + Средняя, не оплачено, в ближ. FREEZE_WINDOW дней)
    const frozen_funds = obligations
      .filter(obl =>
        !obl.is_paid &&
        (obl.criticality === 'Высокая' || obl.criticality === 'Средняя') &&
        daysUntilDueDay(obl.due_day) <= FREEZE_WINDOW
      )
      .reduce((s, obl) => s + obl.amount, 0);

    // 3. Свободный баланс
    const free_balance = current_cash - frozen_funds;

    // 4. Дневной лимит
    const daily_limit = free_balance / HORIZON_DAYS;

    // 5. Перерасход сегодня
    const today_overspend = _getTodayOverspend(expenses, daily_limit);

    // 6. Итоговый лимит на сегодня
    const today_limit = daily_limit - today_overspend;

    return {
      current_cash:    Math.round(current_cash),
      frozen_funds:    Math.round(frozen_funds),
      free_balance:    Math.round(free_balance),
      daily_limit:     Math.round(daily_limit),
      today_limit:     Math.round(today_limit),
      today_overspend: Math.round(today_overspend),
    };
  }

  /** Сколько потрачено сегодня сверх дневного лимита */
  function _getTodayOverspend(expenses, daily_limit) {
    const today = new Date().toDateString();
    const todayExpenses = expenses
      .filter(e => new Date(e.created_at).toDateString() === today)
      .reduce((s, e) => s + e.amount, 0);
    const over = todayExpenses - daily_limit;
    return over > 0 ? over : 0;
  }

  /**
   * Статус светофора.
   * @param {Object} balance — результат compute()
   */
  function getStatus(balance) {
    const { today_limit, free_balance, today_overspend } = balance;

    if (today_limit < 0 || free_balance < 0) {
      return {
        state:   'red',
        label:   '⚠️ Риск кассового разрыва',
        message: 'Стоит отложить необязательные траты и найти поступления.',
      };
    }

    if (today_overspend > 0 || today_limit < balance.daily_limit * 0.3) {
      return {
        state:   'yellow',
        label:   '⚡ Лимит пересчитан',
        message: 'Сегодня был перерасход — следующие дни чуть меньше.',
      };
    }

    return {
      state:   'green',
      label:   '✅ Всё в порядке',
      message: 'Траты в пределах безопасного лимита.',
    };
  }

  /**
   * Обязательства в ближайшие N дней.
   * Возвращает Promise<Array>
   */
  async function getUpcomingObligations(days = 7) {
    const obligations = await DB.Obligations.getAll();
    return obligations
      .filter(obl => !obl.is_paid && daysUntilDueDay(obl.due_day) <= days)
      .map(obl => ({ ...obl, days_left: daysUntilDueDay(obl.due_day) }))
      .sort((a, b) => a.days_left - b.days_left);
  }

  /**
   * Контекст для ИИ-Советника.
   * Возвращает Promise<Object>
   */
  async function buildAIContext() {
    const [balance, obligations, incomes, expenses] = await Promise.all([
      compute(),
      DB.Obligations.getAll(),
      DB.Incomes.getAll(),
      DB.Expenses.getAll(),
    ]);

    return {
      balance,
      obligations,
      recent_incomes:  incomes.slice(-10),
      recent_expenses: expenses.slice(-10),
    };
  }

  /**
   * Ожидаемые поступления в ближайшие N дней.
   * Возвращает Promise<Array>
   */
  async function getUpcomingPlannedIncomes(days = 7) {
    const planned = await DB.PlannedIncomes.getAll();
    return planned
      .filter(p => !p.is_received && daysUntilDueDay(p.expected_day) <= days)
      .map(p => ({ ...p, days_left: daysUntilDueDay(p.expected_day) }))
      .sort((a, b) => a.days_left - b.days_left);
  }

  return {
    compute,
    getStatus,
    getUpcomingObligations,
    getUpcomingPlannedIncomes,
    buildAIContext,
    daysUntilDueDay,
    HORIZON_DAYS,
    FREEZE_WINDOW,
  };

})();
