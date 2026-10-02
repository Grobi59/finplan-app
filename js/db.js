/**
 * db.js — Async Data Layer
 * Storage: Telegram CloudStorage (primary) → LocalStorage (fallback)
 *
 * Telegram CloudStorage API:
 *   setItem(key, value, callback(err, success))
 *   getItem(key, callback(err, value))
 *   removeItem(key, callback(err, success))
 *   Max: 1024 keys · 128 chars per key · 4096 bytes per value
 *
 * All public methods return Promises.
 */

const DB = (() => {

  // ——— Detect storage provider ———
  const TG = window.Telegram?.WebApp;
  const CS = TG?.CloudStorage;
  const useTelegramCloud = !!CS && (TG.isVersionAtLeast ? TG.isVersionAtLeast('6.9') : false);

  // ——— Keys ———
  const KEYS = {
    OBLIGATIONS: 'fp_v2_obligations',
    INCOMES:     'fp_v2_incomes',
    EXPENSES:    'fp_v2_expenses',
    SETTINGS:    'fp_v2_settings',
  };

  // ——— Low-level storage adapter ———
  const Storage = {

    get(key) {
      return new Promise((resolve) => {
        if (!useTelegramCloud) {
          return resolve(localStorage.getItem(key));
        }

        let answered = false;
        const timer = setTimeout(() => {
          if (!answered) {
            answered = true;
            console.warn(`[DB] CloudStorage get timeout for ${key}, fallback to localStorage`);
            resolve(localStorage.getItem(key));
          }
        }, 1000);

        try {
          CS.getItem(key, (err, value) => {
            if (answered) return;
            answered = true;
            clearTimeout(timer);
            if (err) resolve(localStorage.getItem(key)); // fallback on error
            else resolve(value ? value : null);
          });
        } catch (e) {
          if (!answered) {
            answered = true;
            clearTimeout(timer);
            resolve(localStorage.getItem(key));
          }
        }
      });
    },

    set(key, value) {
      return new Promise((resolve) => {
        // Всегда дублируем локально для надежности
        try { localStorage.setItem(key, value); } catch(e) {}

        if (!useTelegramCloud) return resolve(true);

        let answered = false;
        const timer = setTimeout(() => {
          if (!answered) {
            answered = true;
            resolve(true); // already saved locally
          }
        }, 1000);

        try {
          CS.setItem(key, value, (err, success) => {
            if (answered) return;
            answered = true;
            clearTimeout(timer);
            resolve(!err && success);
          });
        } catch (e) {
          if (!answered) {
            answered = true;
            clearTimeout(timer);
            resolve(true);
          }
        }
      });
    },

    remove(key) {
      return new Promise((resolve) => {
        try { localStorage.removeItem(key); } catch(e) {}

        if (!useTelegramCloud) return resolve();

        let answered = false;
        const timer = setTimeout(() => {
          if (!answered) {
            answered = true;
            resolve();
          }
        }, 1000);

        try {
          CS.removeItem(key, (err, success) => {
            if (answered) return;
            answered = true;
            clearTimeout(timer);
            resolve();
          });
        } catch (e) {
          if (!answered) {
            answered = true;
            clearTimeout(timer);
            resolve();
          }
        }
      });
    },
  };

  // ——— Helpers ———
  async function loadArray(key) {
    const raw = await Storage.get(key);
    if (!raw) return [];
    try { return JSON.parse(raw) || []; }
    catch { return []; }
  }

  async function saveArray(key, arr) {
    return Storage.set(key, JSON.stringify(arr));
  }

  async function loadObj(key) {
    const raw = await Storage.get(key);
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; }
    catch { return {}; }
  }

  async function saveObj(key, obj) {
    return Storage.set(key, JSON.stringify(obj));
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ========================================================
  // OBLIGATIONS («Горящие точки»)
  // ========================================================
  const Obligations = {

    async getAll() {
      return loadArray(KEYS.OBLIGATIONS);
    },

    async add({ title, amount, due_day, criticality }) {
      const items = await this.getAll();
      const item = {
        id:          genId(),
        title:       String(title).trim(),
        amount:      parseFloat(amount) || 0,
        due_day:     parseInt(due_day)  || 1,
        criticality: criticality || 'Средняя',
        is_paid:     false,
        created_at:  new Date().toISOString(),
      };
      items.push(item);
      await saveArray(KEYS.OBLIGATIONS, items);
      return item;
    },

    async togglePaid(id) {
      const items = await this.getAll();
      const idx = items.findIndex(x => x.id === id);
      if (idx === -1) return null;
      items[idx].is_paid = !items[idx].is_paid;
      await saveArray(KEYS.OBLIGATIONS, items);
      return items[idx];
    },

    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return saveArray(KEYS.OBLIGATIONS, items);
    },

    async resetPaidForNewMonth() {
      const items = (await this.getAll()).map(x => ({ ...x, is_paid: false }));
      return saveArray(KEYS.OBLIGATIONS, items);
    },
  };

  // ========================================================
  // INCOMES («Поступления»)
  // ========================================================
  const Incomes = {

    async getAll() {
      return loadArray(KEYS.INCOMES);
    },

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
      await saveArray(KEYS.INCOMES, items);
      return item;
    },

    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return saveArray(KEYS.INCOMES, items);
    },
  };

  // ========================================================
  // EXPENSES («Расходы»)
  // ========================================================
  const Expenses = {

    async getAll() {
      return loadArray(KEYS.EXPENSES);
    },

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
      await saveArray(KEYS.EXPENSES, items);
      return item;
    },

    async remove(id) {
      const items = (await this.getAll()).filter(x => x.id !== id);
      return saveArray(KEYS.EXPENSES, items);
    },
  };

  // ========================================================
  // SETTINGS
  // ========================================================
  const Settings = {

    async get() {
      return loadObj(KEYS.SETTINGS);
    },

    async set(patch) {
      const current = await this.get();
      const updated = { ...current, ...patch };
      await saveObj(KEYS.SETTINGS, updated);
      return updated;
    },

    async getApiKey() {
      const s = await this.get();
      return s.openai_api_key || '';
    },

    async setApiKey(key) {
      return this.set({ openai_api_key: key });
    },

    async getLastMonth() {
      const s = await this.get();
      return s.last_month || null;
    },

    async setLastMonth(ym) {
      return this.set({ last_month: ym });
    },
  };

  return {
    Obligations,
    Incomes,
    Expenses,
    Settings,
    genId,
    /** true = Telegram CloudStorage активен, false = LocalStorage fallback */
    isCloudStorage: useTelegramCloud,
  };

})();
