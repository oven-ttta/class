// Posts to the Discord webhook kept in the DISCORD_WEBHOOK_URL environment variable (never in the code).
const MAX_FIELD = 1000;

export const webhookUrl = () => process.env.DISCORD_WEBHOOK_URL || '';

// Text comes from page visitors: keep it short and make sure it can never ping @everyone, roles or users.
export function clean(s, n = 200) {
  return String(s ?? '').replace(/@(everyone|here)/gi, '@​$1').replace(/<@[!&]?\d+>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
}

export async function postDiscord({ title, description = '', lines = [], color = 0x2c5bcc, url = '' }) {
  const hook = webhookUrl();
  if (!hook) return { ok: false, status: 503, error: 'DISCORD_WEBHOOK_URL is not set' };
  let body = lines.map((l) => `• ${clean(l, 300)}`).join('\n');
  if (body.length > 3800) body = body.slice(0, 3800) + '\n…';
  const embed = {
    title: clean(title, 240),
    description: [clean(description, 400), body].filter(Boolean).join('\n\n').slice(0, 4000),
    color,
    timestamp: new Date().toISOString(),
    footer: { text: 'สมุดตารางเรียน' },
  };
  if (url) embed.url = url;
  const r = await fetch(hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'สมุดตารางเรียน', embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    console.error('Discord error', r.status, text.slice(0, MAX_FIELD));
    return { ok: false, status: r.status, error: text.slice(0, 300) };
  }
  return { ok: true };
}
