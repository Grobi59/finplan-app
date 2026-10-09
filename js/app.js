/**
 * app.js — Точка входа (async)
 * TWA init, обработка форм, ИИ-чат
 */

// ——— Telegram Web App ———
const TG = window.Telegram?.WebApp;

function initTelegram() {
  if (!TG) return;
  TG.ready();
  TG.expand();

  // Показываем источник хранилища в консоли
  console.log(`[ФинПлан] Storage: ${DB.isCloudStorage ? '☁️ Telegram CloudStorage' : '💾 LocalStorage (fallback)'}`);

  TG.BackButton.onClick(() => {
    const active = document.querySelector('.tab-panel.active');
    if (active && active.id !== 'tab-home') {
      switchTab('home', document.getElementById('nav-home'));
    }
  });
}

// ——— Сброс статуса оплаты при смене месяца ———
async function checkMonthReset() {
  const now  = new Date();
  const ym   = `${now.getFullYear()}-${now.getMonth()}`;
  const last = await DB.Settings.getLastMonth();

  if (last && last !== ym) {
    await DB.Obligations.resetPaidForNewMonth();
    
    // Начисляем проценты по кредитам
    const credits = await DB.Credits.getAll();
    for (const credit of credits) {
      if (credit.current_debt > 0 && credit.interest_rate > 0) {
        const monthlyRate = credit.interest_rate / 12 / 100;
        const interest = credit.current_debt * monthlyRate;
        const newDebt = credit.current_debt + interest;
        await DB.Credits.update(credit.id, { current_debt: newDebt });
      }
    }

    showToast('🔄 Новый месяц! Сброшены статусы, начислены % по кредитам.');
  }

  await DB.Settings.setLastMonth(ym);
}

// ============================================================
// FORM: ДОХОД
// ============================================================
async function submitIncome(e) {
  e.preventDefault();
  const id     = document.getElementById('income-id')?.value;
  const amountStr = document.getElementById('income-amount').value.replace(/\\s/g, '').replace(',', '.');
  const amount = parseFloat(amountStr);
  const source = document.getElementById('income-source').value || 'Поступление';

  if (!amount || amount <= 0) { showToast('⚠️ Введите сумму'); return; }

  if (id) {
    await DB.Incomes.update(id, { amount, source });
    showToast(`✅ Доход обновлен`);
  } else {
    await DB.Incomes.add({ amount, source });
    showToast(`✅ Доход +${fmt(amount)} добавлен`);
  }
  
  document.getElementById('form-income').reset();
  closeModal('modal-income');
  await renderAll();
  TG?.HapticFeedback?.notificationOccurred('success');
}

// ============================================================
// FORM: РАСХОД
// ============================================================
async function submitExpense(e) {
  e.preventDefault();
  const id          = document.getElementById('expense-id')?.value;
  const amountStr = document.getElementById('expense-amount').value.replace(/\\s/g, '').replace(',', '.');
  const amount      = parseFloat(amountStr);
  const description = document.getElementById('expense-desc').value || 'Расход';

  if (!amount || amount <= 0) { showToast('⚠️ Введите сумму'); return; }

  if (id) {
    await DB.Expenses.update(id, { amount, description });
    showToast(`📉 Расход обновлен`);
  } else {
    await DB.Expenses.add({ amount, description });
    showToast(`📉 Расход −${fmt(amount)} добавлен`);
  }
  
  document.getElementById('form-expense').reset();
  closeModal('modal-expense');
  await renderAll();
  TG?.HapticFeedback?.notificationOccurred('warning');
}

// ============================================================
// QR SCANNER (ЧЕКИ)
// ============================================================
let html5QrCode = null;

function scanReceipt() {
  openModal('modal-scanner');
  
  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("qr-reader");
  }

  html5QrCode.start(
    { facingMode: "environment" }, // используем заднюю камеру
    { fps: 10, qrbox: { width: 250, height: 250 } },
    (decodedText) => {
      // Успешно считано
      closeScannerModal();
      processReceipt(decodedText);
    },
    (errorMessage) => {
      // Игнорируем ошибки при поиске QR-кода в кадре
    }
  ).catch((err) => {
    closeScannerModal();
    showToast('⚠️ Ошибка камеры: нет доступа или устройства');
  });
}

function closeScannerModal(e) {
  if (e && e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
    // клик по фону
  } else if (e && e.target) {
    // клик по кнопке
  } else if (e) {
    return;
  }
  
  closeModal('modal-scanner');
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().catch(err => console.error(err));
  }
}

function processReceipt(qrText) {
  try {
    const params = new URLSearchParams(qrText);
    const sumParam = params.get('s');
    
    if (sumParam) {
      const amount = parseFloat(sumParam);
      
      if (amount > 0) {
        // Открываем модалку добавления расхода (предполагается что openAddExpense глобальна)
        if (typeof openAddExpense === 'function') {
          openAddExpense();
          // Автозаполнение суммы
          setTimeout(() => {
            const input = document.getElementById('expense-amount');
            if (input) input.value = amount;
            // Фокус на поле описания
            const desc = document.getElementById('expense-desc');
            if (desc) desc.focus();
          }, 100);
        }
        
        showToast('✅ Сумма чека распознана!');
        TG?.HapticFeedback?.notificationOccurred('success');
      } else {
        showToast('⚠️ Не удалось определить сумму');
      }
    } else {
      showToast('⚠️ Это не похоже на фискальный чек');
    }
  } catch (e) {
    console.error('Ошибка парсинга QR чека:', e);
    showToast('⚠️ Ошибка при чтении QR-кода');
  }
}

// ============================================================
// FORM: ОБЯЗАТЕЛЬСТВО
// ============================================================
async function submitObligation(e) {
  e.preventDefault();
  const id          = document.getElementById('obl-id')?.value;
  const title       = document.getElementById('obl-title').value;
  const amountStr   = document.getElementById('obl-amount').value.replace(/\\s/g, '').replace(',', '.');
  const amount      = parseFloat(amountStr);
  const due_day     = parseInt(document.getElementById('obl-due-day').value);
  const criticality = document.getElementById('obl-criticality').value;
  const is_recurring = document.getElementById('obl-is-recurring').checked;

  if (!title || !amount || !due_day || !criticality) {
    showToast('⚠️ Заполните все поля');
    return;
  }

  if (id) {
    await DB.Obligations.update(id, { title, amount, due_day, criticality, is_recurring });
    showToast(`🔥 Обязательство «${title}» обновлено`);
  } else {
    await DB.Obligations.add({ title, amount, due_day, criticality, is_recurring });
    showToast(`🔥 Обязательство «${title}» добавлено`);
  }

  document.getElementById('form-obligation').reset();
  closeModal('modal-obligation');
  await renderAll();
  TG?.HapticFeedback?.notificationOccurred('success');
}

// ============================================================
// FORM: КРЕДИТЫ И КАРТЫ
// ============================================================
async function submitCredit(e) {
  e.preventDefault();
  const id          = document.getElementById('credit-id')?.value;
  const title       = document.getElementById('credit-title').value;
  const type        = document.getElementById('credit-type').value;
  const debtStr     = document.getElementById('credit-debt').value.replace(/\\s/g, '').replace(',', '.');
  const current_debt = parseFloat(debtStr);
  const limitStr    = document.getElementById('credit-limit').value.replace(/\\s/g, '').replace(',', '.');
  const limit       = parseFloat(limitStr) || 0;
  const minPayStr   = document.getElementById('credit-min-payment').value.replace(/\\s/g, '').replace(',', '.');
  const min_payment = parseFloat(minPayStr) || 0;
  const rateStr     = document.getElementById('credit-rate').value.replace(/\\s/g, '').replace(',', '.');
  const interest_rate = parseFloat(rateStr) || 0;
  const due_day     = parseInt(document.getElementById('credit-due-day').value);

  if (!title || isNaN(current_debt) || !due_day) {
    showToast('⚠️ Заполните основные поля');
    return;
  }

  if (id) {
    await DB.Credits.update(id, { title, type, current_debt, limit, min_payment, interest_rate, due_day });
    showToast(`💳 Кредит «${title}» обновлен`);
  } else {
    await DB.Credits.add({ title, type, current_debt, limit, min_payment, interest_rate, due_day });
    showToast(`💳 Кредит «${title}» добавлен`);
  }

  document.getElementById('form-credit').reset();
  closeModal('modal-credit');
  await renderAll();
  TG?.HapticFeedback?.notificationOccurred('success');
}

async function submitPayCredit(e) {
  e.preventDefault();
  const id        = document.getElementById('pay-credit-id').value;
  const amountStr = document.getElementById('pay-credit-amount').value.replace(/\\s/g, '').replace(',', '.');
  const amount    = parseFloat(amountStr);

  if (!amount || amount <= 0) {
    showToast('⚠️ Введите сумму платежа');
    return;
  }

  const credits = await DB.Credits.getAll();
  const credit = credits.find(x => x.id === id);
  if (!credit) return;

  // Уменьшаем долг
  let newDebt = credit.current_debt - amount;
  if (newDebt < 0) newDebt = 0;
  await DB.Credits.update(id, { current_debt: newDebt });

  // Добавляем как расход
  await DB.Expenses.add({ amount, description: `Платеж по кредиту: ${credit.title}` });

  showToast(`✅ Платеж ${fmt(amount)} внесен!`);
  
  document.getElementById('form-pay-credit').reset();
  closeModal('modal-pay-credit');
  await renderAll();
  TG?.HapticFeedback?.notificationOccurred('success');
}

// ============================================================
// FORM: ОЖИДАНИЕ (PLANNED)
// ============================================================
async function submitPlanned(e) {
  e.preventDefault();
  const id          = document.getElementById('planned-id')?.value;
  const source      = document.getElementById('planned-source').value;
  const amountStr   = document.getElementById('planned-amount').value.replace(/\\s/g, '').replace(',', '.');
  const amount      = parseFloat(amountStr);
  const expected_day = parseInt(document.getElementById('planned-day').value);

  if (!source || !amount || !expected_day) {
    showToast('⚠️ Заполните все поля');
    return;
  }

  if (id) {
    await DB.PlannedIncomes.update(id, { source, amount, expected_day });
    showToast(`⏳ Ожидание «${source}» обновлено`);
  } else {
    await DB.PlannedIncomes.add({ source, amount, expected_day });
    showToast(`⏳ Ожидание «${source}» добавлено`);
  }

  document.getElementById('form-planned').reset();
  closeModal('modal-planned');
  await renderAll();
  TG?.HapticFeedback?.notificationOccurred('success');
}

// ============================================================
// API KEY
// ============================================================
function toggleApiInputs() {
  const provider = document.getElementById('ai-provider').value;
  document.getElementById('group-openai-key').style.display = provider === 'openai' ? 'block' : 'none';
  document.getElementById('group-gemini-key').style.display = provider === 'gemini' ? 'block' : 'none';
}

async function saveApiKey(e) {
  e.preventDefault();
  const provider = document.getElementById('ai-provider').value;
  const openAiKey = document.getElementById('api-key-input').value.trim();
  const geminiKey = document.getElementById('gemini-key-input').value.trim();
  
  await DB.Settings.setAiProvider(provider);
  await DB.Settings.setApiKey(openAiKey);
  await DB.Settings.setGeminiKey(geminiKey);
  
  closeModal('modal-api-key');
  updateApiKeyNotice();
  showToast('🔑 Настройки ИИ сохранены');
}

async function updateApiKeyNotice() {
  const notice = document.getElementById('api-key-notice');
  const provider = await DB.Settings.getAiProvider();
  const openAiKey = await DB.Settings.getApiKey();
  const geminiKey = await DB.Settings.getGeminiKey();
  
  const hasKey = (provider === 'gemini' && geminiKey) || (provider === 'openai' && openAiKey);
  notice.classList.toggle('hidden', hasKey);
}

// ============================================================
// AI CHAT
// ============================================================
const chatHistory = [];

function buildSystemPrompt(ctx) {
  const { balance, obligations, recent_incomes, recent_expenses } = ctx;

  const oblList = obligations.length
    ? obligations.map(o =>
        `  • ${o.title}: ${o.amount}₽, ${o.due_day}-го, критичность: ${o.criticality}, оплачено: ${o.is_paid ? 'да' : 'нет'}`
      ).join('\n')
    : '  (нет обязательств)';

  const incList = recent_incomes.length
    ? recent_incomes.map(i =>
        `  • ${i.source}: +${i.amount}₽ (${new Date(i.created_at).toLocaleDateString('ru-RU')})`
      ).join('\n')
    : '  (нет данных)';

  const expList = recent_expenses.length
    ? recent_expenses.map(e =>
        `  • ${e.description}: −${e.amount}₽ (${new Date(e.created_at).toLocaleDateString('ru-RU')})`
      ).join('\n')
    : '  (нет данных)';

  return `Ты — финансовый советник приложения ФинПлан для предпринимателей с нерегулярным доходом. Общайся по-русски, тон — поддерживающий, мягкий, без паники. Предлагай конкретные выходы.

ТЕКУЩИЙ ФИНАНСОВЫЙ СРЕЗ:
• Кэш на руках: ${balance.current_cash}₽
• Заморожено под обязательства: ${balance.frozen_funds}₽
• Свободный баланс: ${balance.free_balance}₽
• Безопасный лимит на сегодня: ${balance.today_limit}₽

ОБЯЗАТЕЛЬСТВА:
${oblList}

ПОСЛЕДНИЕ ДОХОДЫ:
${incList}

ПОСЛЕДНИЕ РАСХОДЫ:
${expList}

Отвечай кратко и по делу. Используй цифры из данных. Если спрашивают про конкретную сумму — посчитай, как она повлияет на баланс и обязательства.`;
}

async function sendMessage() {
  const input  = document.getElementById('chat-input');
  const text   = input.value.trim();
  if (!text) return;

  const provider = await DB.Settings.getAiProvider();
  const openAiKey = await DB.Settings.getApiKey();
  const geminiKey = await DB.Settings.getGeminiKey();
  
  const hasKey = (provider === 'gemini' && geminiKey) || (provider === 'openai' && openAiKey);
  if (!hasKey) { openModal('modal-api-key'); return; }

  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';

  const typingEl = appendTyping();
  const sendBtn  = document.getElementById('chat-send-btn');
  sendBtn.disabled = true;

  try {
    const ctx          = await Calculator.buildAIContext();
    const systemPrompt = buildSystemPrompt(ctx);
    let reply = 'Нет ответа от ИИ.';

    if (provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${openAiKey}`,
        },
        body: JSON.stringify({
          model:       'gpt-4o-mini',
          messages:    [
            { role: 'system', content: systemPrompt },
            ...chatHistory.slice(-10),
          ],
          max_tokens:  2000,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      const data  = await response.json();
      reply = data.choices?.[0]?.message?.content?.trim() || 'Нет ответа от ИИ.';
    }
    else if (provider === 'gemini') {
      const geminiHistory = chatHistory.slice(-10).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
      
      const cleanGeminiKey = geminiKey.replace(/[^\x20-\x7E]/g, '');
      // Оставляем только актуальные модели 2026 года
      const fallbackModels = ['gemini-3.8-flash', 'gemini-3.8-pro', 'gemini-3.8-flash-lite'];
      
      let success = false;
      let lastErr = null;
      let isOverloaded = false;
      
      for (const modelId of fallbackModels) {
        if (success) break;
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              'x-goog-api-key': cleanGeminiKey 
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: geminiHistory,
              generationConfig: { maxOutputTokens: 2000, temperature: 0.7 }
            })
          });
          
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
          }
          
          const data = await response.json();
          reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (reply) success = true;
        } catch (err) {
          console.warn(`[Gemini API] Модель ${modelId} выдала ошибку:`, err.message);
          if (err.message.toLowerCase().includes('high demand') || err.message.includes('429')) {
            isOverloaded = true;
          }
          // Сохраняем ошибку, только если это не банальный 404 (чтобы не затирать важные ошибки)
          if (!err.message.includes('not found')) {
            lastErr = err;
          }
        }
      }
      
      if (!success) {
        if (isOverloaded) {
          throw new Error('Серверы Google сейчас перегружены (High Demand). Пожалуйста, подождите немного и попробуйте снова.');
        }
        throw new Error(lastErr?.message || 'Все модели недоступны.');
      }
    }

    chatHistory.push({ role: 'assistant', content: reply });

    typingEl.remove();
    appendMessage('bot', reply);

  } catch (err) {
    typingEl.remove();
    const msg = err.message.includes('401')
      ? 'Неверный API-ключ. Проверьте настройки.'
      : `Ошибка: ${err.message}`;
    appendMessage('bot', `⚠️ ${msg}`);
  } finally {
    sendBtn.disabled = false;
  }
}

function sendScenario(btn) {
  document.getElementById('chat-input').value = btn.dataset.text;
  sendMessage();
}

function appendMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const isBot     = role === 'bot';
  const cls       = isBot ? 'bot-message' : 'user-message';
  const time      = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const html = content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');

  const div = document.createElement('div');
  div.className = `chat-message ${cls}`;
  div.innerHTML = `
    <div class="message-bubble">${html}</div>
    <span class="message-time">${time}</span>
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendTyping() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.innerHTML = `
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function handleChatKey(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  // Сначала сбрасываем высоту, чтобы корректно посчитать scrollHeight при удалении текста
  el.style.height = '1px';
  // Устанавливаем новую высоту, ограниченную 120px (плюс 2px на бордеры)
  el.style.height = Math.min(el.scrollHeight + 2, 120) + 'px';
}

// ============================================================
// DEMO DATA (только при первом запуске)
// ============================================================
async function seedDemoData() {
  const today  = new Date().getDate();
  const credit = today + 2 > 28 ? 1 : today + 2;

  await Promise.all([
    DB.Incomes.add({ amount: 85000, source: 'Фриланс — Клиент А' }),
    DB.Incomes.add({ amount: 32000, source: 'Консультация' }),
    DB.Expenses.add({ amount: 2500,  description: 'Кафе и еда' }),
    DB.Expenses.add({ amount: 800,   description: 'Подписки' }),
  ]);

  await Promise.all([
    DB.Obligations.add({ title: 'Аренда офиса',  amount: 28000, due_day: (today % 28) + 7, criticality: 'Высокая' }),
    DB.Obligations.add({ title: 'Налог УСН',      amount: 12000, due_day: 25,               criticality: 'Высокая' }),
    DB.Obligations.add({ title: 'Кредит',         amount: 15000, due_day: credit,            criticality: 'Высокая' }),
    DB.Obligations.add({ title: 'Adobe Creative', amount: 3200,  due_day: 10,               criticality: 'Средняя' }),
    DB.Obligations.add({ title: 'Интернет',       amount: 900,   due_day: 20,               criticality: 'Низкая'  }),
  ]);
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Telegram SDK
  initTelegram();

  // 2. Дата в шапке
  renderHeaderDate();

  // 3. Проверка смены месяца
  await checkMonthReset();

  // 4. Проверяем наличие данных → демо при первом запуске
  const [incomes, obligations] = await Promise.all([
    DB.Incomes.getAll(),
    DB.Obligations.getAll(),
  ]);

  if (!incomes.length && !obligations.length) {
    await seedDemoData();
  }

  // 5. Рендер всего приложения
  await renderAll();

  // 6. API-ключ
  await updateApiKeyNotice();

  // 7. Подставляем существующий ключ в форму
  const provider = await DB.Settings.getAiProvider();
  const openAiKey = await DB.Settings.getApiKey();
  const geminiKey = await DB.Settings.getGeminiKey();
  
  document.getElementById('ai-provider').value = provider;
  if (openAiKey) document.getElementById('api-key-input').value = openAiKey;
  if (geminiKey) document.getElementById('gemini-key-input').value = geminiKey;
  if (typeof toggleApiInputs === 'function') toggleApiInputs();

  // 8. Индикатор хранилища (только в dev-режиме, вне Telegram)
  if (!DB.isCloudStorage) {
    console.warn('[ФинПлан] Telegram не обнаружен — используется LocalStorage как fallback.');
  }
});
