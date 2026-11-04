// The page reports what changed; this forwards a short summary to Discord.
import { postDiscord, webhookUrl, clean } from '../lib/discord.js';

const KINDS = {
  changes: { color: 0x2c5bcc, title: (b) => `✏️ ${clean(b.who || 'มีคน', 60)}แก้ไขตาราง` },
  clash: { color: 0xb3261e, title: () => '⚠️ มีคาบสอนชนกับเวลาเรียน' },
  test: { color: 0x2a7a70, title: () => '✅ ทดสอบการแจ้งเตือนจากสมุดตารางเรียน' },
};

// Best effort: one Vercel instance keeps a short memory, so a single visitor can't flood the channel.
const recent = [];

export default async function handler(req, res) {
  const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
  if (req.method !== 'POST') return send(405, { error: 'ใช้ได้เฉพาะ POST' });
  if (!webhookUrl()) return send(503, { error: 'ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL ใน Vercel' });
  let b = req.body;
  try { if (typeof b === 'string') b = JSON.parse(b); } catch { b = null; }
  const kind = KINDS[b?.type];
  if (!kind) return send(400, { error: 'ไม่รู้จักประเภทการแจ้งเตือน' });
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 15).map((l) => clean(l, 200)).filter(Boolean);
  if (b.type !== 'test' && !lines.length) return send(400, { error: 'ไม่มีรายละเอียด' });

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= 10) return send(429, { error: 'แจ้งเตือนถี่เกินไป รอสักครู่' });
  recent.push(now);

  const site = req.headers?.host ? `https://${req.headers.host}/` : '';
  const out = await postDiscord({
    title: kind.title(b),
    description: b.type === 'test' ? 'ถ้าเห็นข้อความนี้ แปลว่าการแจ้งเตือนใช้งานได้แล้ว' : '',
    lines,
    color: kind.color,
    url: site,
  });
  return out.ok ? send(200, { ok: true }) : send(502, { error: `ส่งไป Discord ไม่สำเร็จ (${out.status})`, detail: out.error });
}
