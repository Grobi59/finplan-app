# Настройка уведомлений Telegram через Supabase

Этот гайд поможет вам настроить ежедневные автоматические уведомления. Нам нужно будет создать Edge-функцию для отправки сообщений и настроить планировщик.

## Шаг 1. Создание Edge Function

Для работы с функциями вам понадобится установленный на компьютере интерфейс командной строки Supabase (Supabase CLI) или Docker. Но самый простой путь для создания одной функции — **развернуть ее напрямую**. Если у вас еще нет CLI:

1. Откройте терминал в папке с вашим проектом.
2. Инициализируйте Supabase (потребуется авторизация):
   ```bash
   npx supabase init
   npx supabase login
   ```
3. Свяжите локальный проект с вашим проектом в Supabase (он попросит ввести пароль БД):
   ```bash
   npx supabase link --project-ref ijmmvogbbibxmlkuwzli
   ```
4. Создайте новую функцию:
   ```bash
   npx supabase functions new telegram-notify
   ```

## Шаг 2. Код функции

В вашем проекте появится папка `supabase/functions/telegram-notify`. Откройте файл `index.ts` в ней и полностью замените его содержимое на этот код:

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Токен бота мы добавим в секреты Supabase позже
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Создаем админский клиент для доступа ко всей базе
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  try {
    // Получаем всех пользователей
    const { data: users, error } = await supabase.from('user_data').select('*');
    if (error) throw error;
    
    // Вычисляем завтрашний день (с учетом Московского времени +3)
    const date = new Date();
    date.setUTCHours(date.getUTCHours() + 3);
    date.setDate(date.getDate() + 1);
    const tomorrowDay = date.getDate();

    let messagesSent = 0;

    for (const user of users) {
      if (!user.obligations || !Array.isArray(user.obligations)) continue;

      // Ищем неоплаченные обязательства со сроком "завтра"
      const dueObligations = user.obligations.filter((obl: any) => 
        !obl.is_paid && obl.due_day === tomorrowDay
      );

      if (dueObligations.length > 0) {
        let text = `⚠️ <b>Напоминание о платежах (завтра)!</b>\n\n`;
        let total = 0;
        
        dueObligations.forEach((obl: any) => {
          text += `• ${obl.title}: ${obl.amount} ₽\n`;
          total += obl.amount;
        });
        
        text += `\n<b>Всего к оплате:</b> ${total} ₽`;

        // Отправляем сообщение пользователю
        // user.user_id должен совпадать с Telegram Chat ID (это так, если он получен через Telegram.WebApp)
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.user_id,
            text: text,
            parse_mode: 'HTML'
          })
        });
        
        messagesSent++;
      }
    }

    return new Response(JSON.stringify({ success: true, messagesSent }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
})
```

## Шаг 3. Деплой и секреты

1. Разверните функцию в облако Supabase:
   ```bash
   npx supabase functions deploy telegram-notify
   ```
2. Установите токен вашего Telegram Бота в качестве секрета, чтобы функция могла им пользоваться (замените `YOUR_BOT_TOKEN_HERE` на токен от BotFather):
   ```bash
   npx supabase secrets set TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN_HERE
   ```

## Шаг 4. Настройка расписания (Cron)

Теперь нужно сделать так, чтобы функция сама запускалась каждый день. 
Перейдите в веб-интерфейс Supabase -> раздел **SQL Editor**. 
Создайте новый скрипт (New Query) и выполните следующий код:

```sql
-- Включаем нужные расширения
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Добавляем задачу, которая будет запускаться каждый день в 07:00 UTC (10:00 по Москве)
select cron.schedule(
  'telegram-daily-notifications', 
  '0 7 * * *', 
  $$
    select net.http_post(
        url:='https://ijmmvogbbibxmlkuwzli.supabase.co/functions/v1/telegram-notify',
        headers:='{"Authorization": "Bearer sb_publishable_Gbj0_wDX22lQvpDIjm1JiQ_K4TcHlLc"}'::jsonb
    )
  $$
);
```

### Готово! 🚀
Функция настроена. Если вы захотите проверить её работу не дожидаясь утра, вы можете выполнить POST-запрос к `https://ijmmvogbbibxmlkuwzli.supabase.co/functions/v1/telegram-notify` через Postman или даже выполнить этот код в консоли браузера на любой вкладке:
```javascript
fetch('https://ijmmvogbbibxmlkuwzli.supabase.co/functions/v1/telegram-notify', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer sb_publishable_Gbj0_wDX22lQvpDIjm1JiQ_K4TcHlLc'
  }
}).then(r => r.json()).then(console.log);
```
