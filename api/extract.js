// Reads timetable screenshots (e.g. from reg.sut.ac.th) with AI and returns structured classes and exams.
// Set GEMINI_API_KEY (free tier) and/or ANTHROPIC_API_KEY in Vercel. Every usable model is tried in turn until one
// answers: the Gemini models this key can use first, then Claude. AI_PROVIDER=gemini|anthropic limits it to one provider.
import Anthropic from '@anthropic-ai/sdk';

const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGES = 4;
const MAX_BASE64 = 4_200_000; // stays under Vercel's 4.5 MB request body limit

const str = (description) => ({ type: 'string', description });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_timetable', 'student', 'days', 'classes', 'exams', 'notes'],
  properties: {
    is_timetable: { type: 'boolean', description: 'false when the images contain no class timetable at all' },
    student: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'faculty', 'program', 'advisor', 'year', 'term'],
      properties: {
        status: str('สถานภาพ, e.g. กำลังศึกษา; empty string if not shown'),
        faculty: str('สำนักวิชา; empty string if not shown'),
        program: str('หลักสูตร; empty string if not shown'),
        advisor: str('อ. ที่ปรึกษา; empty string if not shown'),
        year: str('ปีการศึกษา, e.g. 2569; empty string if not shown'),
        term: str('ภาคการศึกษา number, e.g. 2; empty string if not shown'),
      },
    },
    days: { type: 'array', description: 'Every day row shown in the timetable, in order', items: { type: 'string', enum: DAYS } },
    classes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'start', 'end', 'code', 'group', 'room', 'dates', 'color'],
        properties: {
          day: { type: 'string', enum: DAYS },
          start: str('Start time, 24-hour HH:MM'),
          end: str('End time, 24-hour HH:MM'),
          code: str('Course code without the section suffix, e.g. "DGT01 0210" or "IST30 1102"'),
          group: str('Group (กลุ่ม) number shown after the comma, e.g. "1"'),
          room: str('Room / building, e.g. "B6501-A" or "DIGITAL TECH LAB 14"'),
          dates: str('Date range exactly as printed, e.g. "19/10/2569-17/1/2570"; empty string if none'),
          color: { type: 'string', enum: ['blue', 'rose', 'green', 'amber', 'violet'], description: 'Cell colour: blue/lavender cells -> blue, red/pink cells -> rose' },
        },
      },
    },
    exams: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'nameEn', 'nameTh', 'group', 'mid', 'final'],
        properties: {
          code: str('Course code as printed in the exam table, e.g. "DGT01 0210-1"'),
          nameEn: str('English course name'),
          nameTh: str('Thai course name'),
          group: str('Group number'),
          mid: str('Midterm exam as two lines: "(C) 30 พ.ย. 2569\\nเวลา 09:00-11:00"; "-" if none'),
          final: str('Final exam in the same format; "-" if none'),
        },
      },
    },
    notes: str('Anything you could not read clearly, in Thai; empty string if everything was clear'),
  },
};

const SYSTEM = `You transcribe Thai university timetable screenshots (usually from the SUT registration site, reg*.sut.ac.th) into structured data.

The timetable grid has one row per day (จันทร์ ... อาทิตย์) and hour columns. Each coloured cell reads "<code>, <group>" then the room, then a date range and the time in brackets, e.g. "DGT01 0210, 1 / B6501-A / 19/10/2569-17/1/2570 (09:00-12:00)". Use the time in brackets when it is printed; otherwise read the start and end from the column headers. A day row can be split into stacked cells that cover different date ranges - record each cell as its own class. A course that meets on several days or in several blocks gets one entry per block.

The exam table (ตารางสอบ) lists code, English and Thai names, group, midterm (สอบกลางภาค) and final (สอบประจำภาค). Drop "N/A (N/A)" room lines. Write "-" when an exam is not scheduled.

Copy codes, rooms and Thai text exactly as printed. Never invent a class that is not in the images. If several images are given, they belong to the same student: merge them and do not duplicate entries.`;



class AIError extends Error {
  // fatal: the problem is the key or account, so trying another model of the same provider will not help.
  constructor(status, error, detail = '', fatal = false) { super(error); Object.assign(this, { status, error, detail, fatal }); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEADLINE_MS = 105_000; // stay inside the 120 s function limit
const userText = (n) => `Transcribe the class timetable and exam table in ${n > 1 ? 'these images' : 'this image'}. Reply with JSON only.`;

// ---------- Google Gemini (free tier: key from https://aistudio.google.com/apikey) ----------
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Gemini's responseSchema uses an OpenAPI subset: upper-case types and no additionalProperties.
function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'additionalProperties') continue;
    if (k === 'type') out.type = String(v).toUpperCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

async function geminiFetch(path, key, body) {
  const r = await fetch(`${GEMINI_BASE}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* non-JSON error page */ }
  return { ok: r.ok, status: r.status, json: j, message: j?.error?.message || '' };
}

// Every model this key can call that can read an image and write text, best guess first:
// Flash, then Flash-Lite, then Pro, then previews, then everything else (e.g. Gemma).
async function listGeminiModels(key) {
  const { ok, json } = await geminiFetch('models?pageSize=1000', key);
  if (!ok) return [];
  const names = (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => !/(image|tts|live|audio|embedding|aqa|imagen|veo|learnlm|computer|robotics|native)/.test(n));
  const rank = (n) => (/flash/.test(n) ? (/lite/.test(n) ? 1 : 0) : /pro/.test(n) ? 2 : 4) + (/(preview|exp)/.test(n) ? 3 : 0);
  return [...new Set(names)].sort((x, y) => rank(x) - rank(y) || y.localeCompare(x));
}

function geminiError(r, model) {
  const m = r.message;
  if (r.status === 400 && /api key/i.test(m)) return new AIError(500, 'GEMINI_API_KEY ไม่ถูกต้อง ตรวจสอบใน Vercel', m, true);
  if (r.status === 403 && /api key|permission|disabled|billing/i.test(m)) return new AIError(500, 'GEMINI_API_KEY ไม่มีสิทธิ์ใช้งาน Gemini API', m, true);
  if (r.status === 429) return new AIError(429, 'ใช้โควตาฟรีของ Gemini หมดแล้ว รอสักครู่ (หรือพรุ่งนี้) แล้วลองใหม่', `${model}: ${m}`);
  if ([500, 503, 504].includes(r.status)) return new AIError(503, 'ตอนนี้ AI ฟรีของ Google มีคนใช้เยอะ ลองใหม่อีกครั้งในอีก 1–2 นาที', `${model}: ${m}`);
  return new AIError(502, `AI ตอบกลับผิดพลาด (${r.status})`, `${model}: ${m}`);
}

async function geminiOnce(model, images, key, withSchema) {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [
      ...images.map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.data } })),
      { text: userText(images.length) + (withSchema ? '' : `\nUse exactly this JSON schema:\n${JSON.stringify(SCHEMA)}`) },
    ] }],
    generationConfig: withSchema
      ? { responseMimeType: 'application/json', responseSchema: toGeminiSchema(SCHEMA), maxOutputTokens: 32000 }
      : { maxOutputTokens: 32000 },
  };
  // Some models (e.g. Gemma) reject system instructions or JSON mode; fold the instructions into the prompt for those.
  if (!withSchema) { body.contents[0].parts.unshift({ text: SYSTEM }); delete body.systemInstruction; }
  const r = await geminiFetch(`models/${model}:generateContent`, key, body);
  if (!r.ok) throw geminiError(r, model);
  const cand = r.json?.candidates?.[0];
  if (!cand) throw new AIError(422, 'AI อ่านรูปนี้ไม่ได้ ลองใช้รูปหน้าตารางเรียนจากระบบทะเบียน', `${model}: ${r.json?.promptFeedback?.blockReason || 'no candidates'}`);
  if (cand.finishReason === 'MAX_TOKENS') throw new AIError(422, 'ตารางยาวเกินไป ลองอัปโหลดทีละรูป', model);
  const text = (cand.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(json); } catch { throw new AIError(502, 'AI ส่งข้อมูลกลับมาไม่ครบ ลองใหม่อีกครั้ง', `${model}: ${cand.finishReason || ''}`); }
}

// ---------- Claude (paid) ----------
function apiMessage(err) {
  return err?.error?.error?.message || err?.message || '';
}

async function extractWithClaude(images) {
  // A key that is not scoped to a workspace must name one; set ANTHROPIC_WORKSPACE_ID in Vercel for that case.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  const content = [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: userText(images.length) },
  ];
  const request = {
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  };
  try {
    let message;
    try {
      message = await client.beta.messages.stream({ ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage();
    } catch (err) {
      // Some accounts cannot use server-side fallbacks yet; retry the same request without them.
      if (!(err instanceof Anthropic.BadRequestError) || !/fallback|beta/i.test(apiMessage(err))) throw err;
      message = await client.beta.messages.stream(request).finalMessage();
    }
    if (message.stop_reason === 'refusal') throw new AIError(422, 'AI อ่านรูปนี้ไม่ได้ ลองใช้รูปหน้าตารางเรียนจากระบบทะเบียน', 'claude: refusal');
    if (message.stop_reason === 'max_tokens') throw new AIError(422, 'ตารางยาวเกินไป ลองอัปโหลดทีละรูป', 'claude: max_tokens');
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    try { return JSON.parse(text); } catch { throw new AIError(502, 'AI ส่งข้อมูลกลับมาไม่ครบ ลองใหม่อีกครั้ง', 'claude: invalid JSON'); }
  } catch (err) {
    if (err instanceof AIError) throw err;
    const d = `claude: ${apiMessage(err)}`;
    if (err instanceof Anthropic.RateLimitError) throw new AIError(429, 'มีคนใช้งานเยอะ ลองใหม่อีกครั้งในอีกสักครู่', d);
    if (err instanceof Anthropic.AuthenticationError) throw new AIError(500, 'ANTHROPIC_API_KEY ไม่ถูกต้อง ตรวจสอบใน Vercel', d, true);
    if (err instanceof Anthropic.APIError) {
      if (/workspace/i.test(d)) throw new AIError(500, 'API key ของ Claude ไม่ได้ผูกกับ workspace: ตั้งค่า ANTHROPIC_WORKSPACE_ID หรือสร้าง key ใหม่ภายใน workspace', d, true);
      if (/credit balance|billing|purchase credits/i.test(d)) throw new AIError(402, 'เครดิตในบัญชี Anthropic ไม่พอ: เติมเครดิตที่ platform.claude.com → Settings → Billing', d, true);
      throw new AIError(502, `AI ตอบกลับผิดพลาด (${err.status ?? 'network'})`, d);
    }
    throw new AIError(502, 'เชื่อมต่อ Claude ไม่ได้ ลองใหม่อีกครั้ง', d);
  }
}

// ---------- try every model until one answers ----------
const usable = (d) => d && d.is_timetable && Array.isArray(d.classes) && d.classes.length > 0;

async function extract(images, env) {
  const started = Date.now();
  const timeLeft = () => DEADLINE_MS - (Date.now() - started);
  const only = (env.AI_PROVIDER || '').toLowerCase();
  const errors = [];
  let empty = null;

  if (env.GEMINI_API_KEY && only !== 'anthropic') {
    const key = env.GEMINI_API_KEY;
    const preferred = (env.GEMINI_MODEL || 'gemini-flash-latest').split(',').map((m) => m.trim()).filter(Boolean);
    let listed = null;
    const queue = [...preferred];
    const tried = new Set();
    let busyRetried = false;
    while (queue.length && timeLeft() > 8000) {
      const model = queue.shift();
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        let data;
        try {
          data = await geminiOnce(model, images, key, true);
        } catch (err) {
          // A model that rejects JSON mode / system instructions may still work with plain instructions.
          if (!(err instanceof AIError) || err.status !== 502 || !/400/.test(err.error)) throw err;
          data = await geminiOnce(model, images, key, false);
        }
        if (usable(data)) return { data, model };
        empty = empty || { data, model };
        errors.push(new AIError(422, 'ไม่พบตารางเรียนในรูป ลองใช้รูปที่เห็นตารางชัด ๆ', `${model}: ${data?.notes || 'no classes'}`));
      } catch (err) {
        const e = err instanceof AIError ? err : new AIError(502, 'เชื่อมต่อ Gemini ไม่ได้ ลองใหม่อีกครั้ง', `${model}: ${err?.message || err}`);
        console.warn('Gemini failed', e.status, e.detail);
        errors.push(e);
        if (e.fatal) break;
        // Busy right now: give the first model one more chance after a short pause.
        if (e.status === 503 && !busyRetried && model === preferred[0]) { busyRetried = true; await sleep(2000); tried.delete(model); queue.push(model); }
      }
      if (!listed) {
        listed = await listGeminiModels(key);
        queue.push(...listed.filter((m) => !tried.has(m)));
      }
    }
  }

  if (env.ANTHROPIC_API_KEY && only !== 'gemini' && timeLeft() > 20000) {
    try {
      const data = await extractWithClaude(images);
      if (usable(data)) return { data, model: 'claude-opus-5-5' };
      empty = empty || { data, model: 'claude-opus-5-5' };
    } catch (err) {
      console.warn('Claude failed', err.status, err.detail);
      errors.push(err instanceof AIError ? err : new AIError(502, 'เชื่อมต่อ Claude ไม่ได้', String(err)));
    }
  }

  if (empty && !errors.some((e) => e.status !== 422)) return empty;
  // Report the most useful failure: "busy, try again" when any model was only busy, else a key/account problem, else the last error.
  const pick = errors.find((e) => e.status === 503) || errors.find((e) => e.status === 429) || errors.find((e) => e.fatal) || errors[errors.length - 1];
  if (pick) throw new AIError(pick.status, pick.error, errors.map((e) => e.detail).filter(Boolean).slice(-4).join(' | '));
  throw new AIError(503, 'ตอนนี้ AI ทุกตัวไม่ว่าง ลองใหม่อีกครั้งในอีก 1–2 นาที');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ได้เฉพาะ POST' });
  const env = process.env;
  if (!env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) {
    return send(res, 503, { error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY (ฟรี) หรือ ANTHROPIC_API_KEY ใน Vercel (Settings → Environment Variables) แล้ว Redeploy' });
  }

  let body = req.body;
  try { if (typeof body === 'string') body = JSON.parse(body); } catch { body = null; }
  const images = Array.isArray(body?.images) ? body.images : [];
  if (!images.length) return send(res, 400, { error: 'ไม่พบรูปที่อัปโหลด' });
  if (images.length > MAX_IMAGES) return send(res, 400, { error: `อัปโหลดได้ครั้งละไม่เกิน ${MAX_IMAGES} รูป` });
  let total = 0;
  for (const img of images) {
    if (!img || typeof img.data !== 'string' || !MEDIA.includes(img.mediaType)) {
      return send(res, 400, { error: 'รองรับเฉพาะรูป JPG, PNG, WEBP หรือ GIF' });
    }
    total += img.data.length;
  }
  if (total > MAX_BASE64) return send(res, 413, { error: 'รูปใหญ่เกินไป ลองอัปโหลดทีละรูป หรือครอปเฉพาะส่วนตาราง' });

  try {
    const { data, model } = await extract(images, env);
    if (!usable(data)) return send(res, 422, { error: 'ไม่พบตารางเรียนในรูป ลองใช้รูปที่เห็นตารางชัด ๆ', detail: data?.notes || '' });
    return send(res, 200, { data, model });
  } catch (err) {
    if (err instanceof AIError) return send(res, err.status, { error: err.error, detail: err.detail });
    console.error(err);
    return send(res, 500, { error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' });
  }
}
