import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  try {
    const { data: users, error } = await supabase.from('user_data').select('*');
    if (error) throw error;
    
    // Текущая дата по МСК
    const now = new Date();
    now.setUTCHours(now.getUTCHours() + 3);
    const todayDay = now.getDate();

    // Дата через 3 дня по МСК
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + 3);
    const dayIn3Days = futureDate.getDate();

    let messagesSent = 0;

    for (const user of users) {
      if (!user.obligations || !Array.isArray(user.obligations)) continue;

      const todayObligations = user.obligations.filter((obl: any) => 
        !obl.is_paid && obl.due_day === todayDay
      );

      const futureObligations = user.obligations.filter((obl: any) => 
        !obl.is_paid && obl.due_day === dayIn3Days
      );

      if (todayObligations.length > 0 || futureObligations.length > 0) {
        let text = `⚠️ <b>Финансовые напоминания</b>\n\n`;
        
        if (todayObligations.length > 0) {
            text += `🚨 <b>К оплате СЕГОДНЯ:</b>\n`;
            let total = 0;
            todayObligations.forEach((obl: any) => {
                text += `• ${obl.title}: ${obl.amount} ₽\n`;
                total += obl.amount;
            });
            text += `<i>Итого сегодня: ${total} ₽</i>\n\n`;
        }

        if (futureObligations.length > 0) {
            text += `⏳ <b>Оплата через 3 дня:</b>\n`;
            let total = 0;
            futureObligations.forEach((obl: any) => {
                text += `• ${obl.title}: ${obl.amount} ₽\n`;
                total += obl.amount;
            });
            text += `<i>Итого через 3 дня: ${total} ₽</i>\n`;
        }

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
