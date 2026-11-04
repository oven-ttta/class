// Discord reminder 30 minutes before each class (the only notification this site sends).
// Call it every 5 minutes from a scheduler such as cron-job.org:
//   https://<your-site>/api/class-reminder?key=<CRON_SECRET>   (or header  Authorization: Bearer <CRON_SECRET>)
// Each class falls in exactly one 5-minute slot, so it is announced once.
// ?dry=1 lists today's reminders without posting anything.
import { postDiscord, webhookUrl } from '../lib/discord.js';
import configHandler from './config.js';

const LEAD_MIN = 30;
const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/); return m ? +m[1] * 60 + +m[2] : null; };

// Now in Thailand: weekday, minutes since midnight, and a day number for date-range checks.
function bangkokNow(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { day: DAYS[wd], minutes: +p.hour * 60 + +p.minute, dayNo: Date.UTC(+p.year, +p.month - 1, +p.day) / 864e5 };
}

// "19/10/2569-17/1/2570" (Buddhist years) -> is today inside? An empty range means every week.
function inRange(dates, dayNo) {
  const parts = String(dates || '').split('-').map((s) => s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/));
  if (parts.length !== 2 || !parts[0] || !parts[1]) return true;
  const n = (m) => { let y = +m[3]; if (y > 2400) y -= 543; return Date.UTC(y, +m[2] - 1, +m[1]) / 864e5; };
  return dayNo >= n(parts[0]) && dayNo <= n(parts[1]);
}

function supabaseSettings() {
  let out = null;
  configHandler({}, { setHeader() {}, end(b) { out = JSON.parse(b); } });
  return out;
}

export default async function handler(req, res) {
  const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };
  const q = new URL(req.url || '/', 'http://x').searchParams;
  const dry = q.get('dry') === '1';
  const secret = process.env.CRON_SECRET;
  if (!dry && secret && q.get('key') !== secret && req.headers?.authorization !== `Bearer ${secret}`) return send(401, { error: 'unauthorized' });
  const step = Math.min(15, Math.max(1, +q.get('every') || 5)); // how often the scheduler calls, in minutes

  const { url, anonKey } = supabaseSettings();
  const r = await fetch(`${url}/rest/v1/schedule_docs?select=data&kind=eq.person`, { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } });
  if (!r.ok) return send(502, { error: `อ่านฐานข้อมูลไม่ได้ (${r.status})` });
  const rows = await r.json();

  const now = bangkokNow();
  const slot = Math.floor(now.minutes / step);
  const today = [];
  for (const { data: p } of rows) {
    for (const c of p?.classes || []) {
      const start = toMin(c.start);
      if (c.day !== now.day || start == null || !inRange(c.dates, now.dayNo)) continue;
      const remindAt = start - LEAD_MIN;
      const name = (p.exams || []).find((e) => String(e.code || '').replace(/-\d+$/, '').trim() === String(c.code).trim());
      today.push({
        remindAt,
        due: remindAt >= 0 && Math.floor(remindAt / step) === slot,
        line: `${p.name}: ${c.code}${c.group ? ' กลุ่ม ' + c.group : ''}${name ? ' ' + (name.nameTh || name.nameEn) : ''} · ${c.start}-${c.end}${c.room ? ' · ห้อง ' + c.room : ''}`,
        start: c.start,
      });
    }
  }
  today.sort((a, b) => a.remindAt - b.remindAt);
  const due = today.filter((x) => x.due);
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (dry) return send(200, { now: `${now.day} ${fmt(now.minutes)}`, dueNow: due.map((x) => x.line), today: today.map((x) => `เตือน ${fmt(Math.max(0, x.remindAt))} → ${x.line}`) });
  if (!due.length) return send(200, { posted: false });
  if (!webhookUrl()) return send(503, { error: 'ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ใน Vercel' });

  const starts = [...new Set(due.map((x) => x.start))].join(', ');
  const out = await postDiscord({ title: `⏰ อีก ${LEAD_MIN} นาทีเข้าเรียน (${starts})`, lines: due.map((x) => x.line), color: 0x2c5bcc });
  return out.ok ? send(200, { posted: true, lines: due.map((x) => x.line) }) : send(502, { error: `ส่งไป Discord ไม่สำเร็จ (${out.status})` });
}
