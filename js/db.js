/**
 * db.js — Supabase Data Layer
 * Storage: Supabase PostgreSQL (via REST API)
 * All public methods return Promises.
 */

const DB = (() => {

  const SUPABASE_URL = 'https://ijmmvogbbibxmlkuwzli.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_Gbj0_wDX22lQvpDIjm1JiQ_K4TcHlLc';
  
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };

  // Идентификация пользователя Telegram
  const TG = window.Telegram?.WebApp;
  const userId = TG?.initDataUnsafe?.user?.id?.toString() || 'demo_user';

  // Названия колонок в БД Supabase
  const COLS = {
    OBLIGATIONS: 'obligations',
    INCOMES:     'incomes',
    EXPENSES:    'expenses',
    SETTINGS:    'settings',
  };

  let isInitialized = false;

  const Storage = {

    async _getRow() {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${userId}&select=*`, { headers });
        const data = await res.json();
        if (data && data.length > 0) return data[0];
        return null;
      } catch (err) {
        console.error('[Supabase] _getRow error:', err);
        return null;
      }
    },

    async initUserRow() {
      if (isInitialized) return;
      const row = await this._getRow();
      if (!row) {
        // Создаем пустую строку для нового пользователя
        await fetch(`${SUPABASE_URL}/rest/v1/user_data`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user_id: userId,
            obligations: [],
            incomes: [],
            expenses: [],
            settings: {}
          })
        });
      }
      isInitialized = true;
    },

    async getCol(colName, defaultVal) {
      await this.initUserRow();
      const row = await this._getRow();
      if (!row) return defaultVal;
      return row[colName] || defaultVal;
    },

    async updateCol(colName, value) {
      await this.initUserRow();
      const patch = {};
      patch[colName] = value;
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/user_data?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(patch)
        });
        return res.ok;
      } catch (err) {
        console.error('[Supabase] updateCol error:', err);
        return false;
      }
    }
  };

  // ——— Helpers ———
  async function loadArray(col) {
    return Storage.getCol(col, []);
  }

  async function saveArray(col, arr) {
    return Storage.updateCol(col, arr);
  }

  async function loadObj(col) {
    return Storage.getCol(col, {});
  }

  async function saveObj(col, obj) {
    return Storage.updateCol(col, obj);
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ========================================================
  // OBLIGATIONS («Горящие точки»)
  // ========================================================
  const Obligations = {
    async getAll() { return loadArray(COLS.OBLIGATIONS); },
    async add({ title, amount, due_day, criticality, is_recurring }) {
      const items = await this.getAll();
      const item = {
        id:          genId(),
        title:       String(title).trim(),
        amount:      parseFloat(amount) || 0,
        due_day:     parseInt(due_day)  || 1,
        criticality: criticality || 'Средняя',
        is_paid:     false,
        is_recurring: is_recurring !== undefined ? is_recurring : true,
        created_at:  new Date().toISOString(),
      };
      items.push(item);
      await saveArray(COLS.OBLIGATIONS, items);
      return item;
    },
    async togglePaid(id) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx === -1) return null;
      items[idx].is_paid = !items[idx].is_paid;
      await saveArray(COLS.OBLIGATIONS, items);
      return items[idx];
    },
    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return saveArray(COLS.OBLIGATIONS, items);
    },
    async update(id, data) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...data };
        await saveArray(COLS.OBLIGATIONS, items);
        return items[idx];
      }
      return null;
    },
    async resetPaidForNewMonth() {
      let items = await this.getAll();
      // Удаляем единоразовые обязательства, если они были оплачены
      items = items.filter(x => !(x.is_paid && x.is_recurring === false));
      // Сбрасываем статус оплаты для оставшихся (регулярных и неоплаченных единоразовых)
      items = items.map(x => ({ ...x, is_paid: false }));
      return saveArray(COLS.OBLIGATIONS, items);
    },
  };

  // ========================================================
  // CREDITS («Кредиты и карты»)
  // Хранятся внутри settings
  // ========================================================
  const Credits = {
    async getAll() {
      const s = await Settings.get();
      return s.credits || [];
    },
    async _save(arr) {
      return Settings.set({ credits: arr });
    },
    async add({ title, type, current_debt, limit, min_payment, interest_rate, due_day }) {
      const items = await this.getAll();
      const item = {
        id: genId(),
        title: String(title || 'Кредит').trim(),
        type: String(type || 'credit'), // 'credit' или 'card'
        current_debt: parseFloat(current_debt) || 0,
        limit: parseFloat(limit) || 0,
        min_payment: parseFloat(min_payment) || 0,
        interest_rate: parseFloat(interest_rate) || 0,
        due_day: parseInt(due_day) || 1,
        created_at: new Date().toISOString(),
      };
      items.push(item);
      await this._save(items);
      return item;
    },
    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return this._save(items);
    },
    async update(id, data) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...data };
        await this._save(items);
        return items[idx];
      }
      return null;
    }
  };

  // ========================================================
  // INCOMES («Поступления»)
  // ========================================================
  const Incomes = {
    async getAll() { return loadArray(COLS.INCOMES); },
    async add({ amount, source }) {
      const items = await this.getAll();
      const item = {
        id:         genId(),
        amount:     parseFloat(amount) || 0,
        source:     String(source || 'Поступление').trim(),
        created_at: new Date().toISOString(),
        type:       'income',
      };
      items.push(item);
      await saveArray(COLS.INCOMES, items);
      return item;
    },
    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return saveArray(COLS.INCOMES, items);
    },
    async update(id, data) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...data };
        await saveArray(COLS.INCOMES, items);
        return items[idx];
      }
      return null;
    },
  };

  // ========================================================
  // EXPENSES («Расходы»)
  // ========================================================
  const Expenses = {
    async getAll() { return loadArray(COLS.EXPENSES); },
    async add({ amount, description }) {
      const items = await this.getAll();
      const item = {
        id:          genId(),
        amount:      parseFloat(amount) || 0,
        description: String(description || 'Расход').trim(),
        created_at:  new Date().toISOString(),
        type:        'expense',
      };
      items.push(item);
      await saveArray(COLS.EXPENSES, items);
      return item;
    },
    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return saveArray(COLS.EXPENSES, items);
    },
    async update(id, data) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...data };
        await saveArray(COLS.EXPENSES, items);
        return items[idx];
      }
      return null;
    },
  };

  // ========================================================
  // SETTINGS
  // ========================================================
  const Settings = {
    async get() { return loadObj(COLS.SETTINGS); },
    async set(patch) {
      const current = await this.get();
      const updated = { ...current, ...patch };
      await saveObj(COLS.SETTINGS, updated);
      return updated;
    },
    async getApiKey() {
      const s = await this.get();
      return s.openai_api_key || '';
    },
    async setApiKey(key) {
      return this.set({ openai_api_key: key });
    },
    async getGeminiKey() {
      const s = await this.get();
      return s.gemini_api_key || '';
    },
    async setGeminiKey(key) {
      return this.set({ gemini_api_key: key });
    },
    async getAiProvider() {
      const s = await this.get();
      return s.ai_provider || 'openai';
    },
    async setAiProvider(provider) {
      return this.set({ ai_provider: provider });
    },
    async getLastMonth() {
      const s = await this.get();
      return s.last_month || null;
    },
    async setLastMonth(ym) {
      return this.set({ last_month: ym });
    },
  };

  // ========================================================
  // PLANNED INCOMES («Планируемые поступления»)
  // Хранятся внутри settings, чтобы не менять схему БД Supabase
  // ========================================================
  const PlannedIncomes = {
    async getAll() {
      const s = await Settings.get();
      return s.planned_incomes || [];
    },
    async _save(arr) {
      return Settings.set({ planned_incomes: arr });
    },
    async add({ source, amount, expected_day }) {
      const items = await this.getAll();
      const item = {
        id: genId(),
        source: String(source || 'Ожидание').trim(),
        amount: parseFloat(amount) || 0,
        expected_day: parseInt(expected_day) || 1,
        is_received: false,
        created_at: new Date().toISOString(),
      };
      items.push(item);
      await this._save(items);
      return item;
    },
    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return this._save(items);
    },
    async update(id, data) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx !== -1) {
        items[idx] = { ...items[idx], ...data };
        await this._save(items);
        return items[idx];
      }
      return null;
    },
    async toggleReceived(id) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx === -1) return null;
      items[idx].is_received = !items[idx].is_received;
      await this._save(items);
      return items[idx];
    },
    async resetReceivedForNewMonth() {
      const items = (await this.getAll()).map(x => ({ ...x, is_received: false }));
      return this._save(items);
    }
  };

  return {
    Obligations,
    Incomes,
    Expenses,
    PlannedIncomes,
    Settings,
    Credits,
    genId,
    // Передаем статус Supabase для отображения в UI
    isCloudStorage: true, 
  };

})();
