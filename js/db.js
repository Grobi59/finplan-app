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
  const useTelegramCloud = !!CS;

  // ——— Keys ———
  const KEYS = {
    OBLIGATIONS: 'fp_v2_obligations',
    INCOMES:     'fp_v2_incomes',
    EXPENSES:    'fp_v2_expenses',
    SETTINGS:    'fp_v2_settings',
  };

  // ——— Low-level storage adapter ———
  const Storage = {

    /**
     * Read a string value by key.
     * Returns null if not found.
     */
    get(key) {
      return new Promise((resolve) => {
        if (useTelegramCloud) {
          CS.getItem(key, (err, value) => {
            // value is empty string '' when key doesn't exist
            resolve((!err && value) ? value : null);
          });
        } else {
          resolve(localStorage.getItem(key));
        }
      });
    },

    /**
     * Write a string value by key.
     */
    set(key, value) {
      return new Promise((resolve, reject) => {
        if (useTelegramCloud) {
          CS.setItem(key, value, (err, success) => {
            if (err) reject(new Error(String(err)));
            else resolve(success);
          });
        } else {
          try {
            localStorage.setItem(key, value);
            resolve(true);
          } catch (e) {
            reject(e);
          }
        }
      });
    },

    /**
     * Delete a key.
     */
    remove(key) {
      return new Promise((resolve) => {
        if (useTelegramCloud) {
          CS.removeItem(key, () => resolve());
        } else {
          localStorage.removeItem(key);
          resolve();
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
