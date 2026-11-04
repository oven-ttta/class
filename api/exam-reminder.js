// Daily exam reminder, run by Vercel Cron (see vercel.json). Reads the shared data from Supabase and posts to Discord
// every exam happening today or in the next 3 days. Add ?dry=1 to see the message without posting it.
import { postDiscord, webhookUrl } from '../lib/discord.js';
import configHandler from './config.js';

const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const DAYS_AHEAD = 3;

// "(C) 30 พ.ย. 2569\nเวลา 09:00-11:00" -> { y, m, d, time }
function parseExam(s) {
  const m = String(s || '').match(/(\d{1,2})\s*([ก-๙]+\.[ก-๙]+\.)\s*(\d{4})/);
  if (!m) return null;
  const mi = TH_M.indexOf(m[2]);
  if (mi < 0) return null;
  let y = +m[3];
  if (y > 2400) y -= 543;
  const t = String(s).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  return { y, m: mi, d: +m[1], time: t ? `${t[1]}-${t[2]}` : '' };
}

// Today's date in Thailand, as a day number we can subtract.
function bangkokDay(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5;
}

function supabaseSettings() {
  let out = null;
  configHandler({}, { setHeader() {}, end(b) { out = JSON.parse(b); } });
  return out;
}

export default async function handler(req, res) {
  const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
  const secret = process.env.CRON_SECRET;
  const dry = /[?&]dry=1/.test(req.url || '');
  if (secret && !dry && req.headers?.authorization !== `Bearer ${secret}`) return send(401, { error: 'unauthorized' });

  const { url, anonKey } = supabaseSettings();
  const r = await fetch(`${url}/rest/v1/schedule_docs?select=id,data&kind=eq.person`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
  if (!r.ok) return send(502, { error: `อ่านฐานข้อมูลไม่ได้ (${r.status})` });
  const rows = await r.json();

  const today = bangkokDay();
  const items = [];
  for (const { data: p } of rows) {
    for (const e of p?.exams || []) {
      for (const [label, when] of [['สอบกลางภาค', e.mid], ['สอบประจำภาค', e.final]]) {
        const x = parseExam(when);
        if (!x) continue;
        const diff = Date.UTC(x.y, x.m, x.d) / 864e5 - today;
        if (diff < 0 || diff > DAYS_AHEAD) continue;
        const dayText = diff === 0 ? '**วันนี้**' : diff === 1 ? '**พรุ่งนี้**' : `อีก ${diff} วัน`;
        items.push({ diff, line: `${dayText} · ${p.name}: ${e.nameTh || e.nameEn || e.code} (${label}) ${x.d} ${TH_M[x.m]} ${x.time ? 'เวลา ' + x.time : ''}`.trim() });
      }
    }
  }
  items.sort((a, b) => a.diff - b.diff);
  const lines = items.map((i) => i.line);
  if (dry || !lines.length) return send(200, { posted: false, dry, lines });
  if (!webhookUrl()) return send(503, { error: 'ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ใน Vercel', lines });
  const out = await postDiscord({ title: `📚 เตือนสอบ: ${lines.length} รายการภายใน ${DAYS_AHEAD} วัน`, lines, color: 0xa8433f });
  return out.ok ? send(200, { posted: true, lines }) : send(502, { error: `ส่งไป Discord ไม่สำเร็จ (${out.status})`, lines });
}
