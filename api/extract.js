// Reads timetable screenshots (e.g. from reg.sut.ac.th) with AI and returns structured classes and exams.
// Set GEMINI_API_KEY (free tier) or ANTHROPIC_API_KEY in Vercel; AI_PROVIDER=gemini|anthropic forces one.
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


// ---------- Google Gemini (has a free tier: key from https://aistudio.google.com/apikey) ----------
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

class AIError extends Error {
  constructor(status, error, detail = '') { super(error); this.status = status; this.error = error; this.detail = detail; }
}

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

// When the configured model name is gone, pick a current Flash model that this key can use.
async function findFlashModel(key) {
  const { ok, json } = await geminiFetch('models?pageSize=200', key);
  if (!ok) return null;
  const names = (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/(lite|image|tts|live|audio|thinking|exp|preview)/.test(n));
  return names.sort().reverse()[0] || null;
}

async function extractWithGemini(images, key) {
  let model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      role: 'user',
      parts: [
        ...images.map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.data } })),
        { text: `Transcribe the class timetable and exam table in ${images.length > 1 ? 'these images' : 'this image'}. Reply with JSON only.` },
      ],
    }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiSchema(SCHEMA), maxOutputTokens: 32000 },
  };
  let r = await geminiFetch(`models/${model}:generateContent`, key, body);
  if (r.status === 404) {
    const alt = await findFlashModel(key);
    if (alt && alt !== model) { model = alt; r = await geminiFetch(`models/${model}:generateContent`, key, body); }
  }
  if (!r.ok) {
    console.error('Gemini error', r.status, model, r.message);
    if (r.status === 429) throw new AIError(429, 'ใช้โควตาฟรีของ Gemini หมดแล้ว รอสักครู่ (หรือพรุ่งนี้) แล้วลองใหม่', r.message);
    if (r.status === 400 && /api key/i.test(r.message)) throw new AIError(500, 'GEMINI_API_KEY ไม่ถูกต้อง ตรวจสอบใน Vercel', r.message);
    if (r.status === 403) throw new AIError(500, 'GEMINI_API_KEY ไม่มีสิทธิ์ใช้งาน Gemini API', r.message);
    if (r.status === 404) throw new AIError(502, `ไม่พบโมเดล ${model}: ตั้งค่า GEMINI_MODEL ใน Vercel`, r.message);
    throw new AIError(502, `AI ตอบกลับผิดพลาด (${r.status})`, r.message);
  }
  const cand = r.json?.candidates?.[0];
  if (!cand) throw new AIError(422, 'AI อ่านรูปนี้ไม่ได้ ลองใช้รูปหน้าตารางเรียนจากระบบทะเบียน', r.json?.promptFeedback?.blockReason || '');
  if (cand.finishReason === 'MAX_TOKENS') throw new AIError(422, 'ตารางยาวเกินไป ลองอัปโหลดทีละรูป');
  const text = (cand.content?.parts || []).map((p) => p.text || '').join('');
  try { return JSON.parse(text); } catch { throw new AIError(502, 'AI ส่งข้อมูลกลับมาไม่ครบ ลองใหม่อีกครั้ง', cand.finishReason || ''); }
}

function apiMessage(err) {
  return err?.error?.error?.message || err?.message || '';
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ได้เฉพาะ POST' });
  // AI_PROVIDER=gemini|anthropic picks one explicitly; otherwise the free Gemini key wins when both are set.
  const env = process.env;
  const provider = env.AI_PROVIDER || (env.GEMINI_API_KEY ? 'gemini' : env.ANTHROPIC_API_KEY ? 'anthropic' : '');
  if (!provider) {
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

  const content = [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
    { type: 'text', text: `Transcribe the class timetable and exam table in ${images.length > 1 ? 'these images' : 'this image'}.` },
  ];

  const finish = (data) => {
    if (!data.is_timetable || !Array.isArray(data.classes) || !data.classes.length) {
      return send(res, 422, { error: 'ไม่พบตารางเรียนในรูป ลองใช้รูปที่เห็นตารางชัด ๆ', detail: data.notes || '' });
    }
    return send(res, 200, { data });
  };

  if (provider === 'gemini') {
    if (!env.GEMINI_API_KEY) return send(res, 503, { error: 'AI_PROVIDER เป็น gemini แต่ยังไม่ได้ตั้งค่า GEMINI_API_KEY' });
    try {
      return finish(await extractWithGemini(images, env.GEMINI_API_KEY));
    } catch (err) {
      if (err instanceof AIError) return send(res, err.status, { error: err.error, detail: err.detail });
      console.error(err);
      return send(res, 502, { error: 'เชื่อมต่อ Gemini ไม่ได้ ลองใหม่อีกครั้ง' });
    }
  }
  if (!env.ANTHROPIC_API_KEY) return send(res, 503, { error: 'AI_PROVIDER เป็น anthropic แต่ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY' });

  // A key that is not scoped to a workspace must name one; set ANTHROPIC_WORKSPACE_ID in Vercel for that case.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {});
  const request = {
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content }],
  };
  const withFallback = { ...request, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
  try {
    let message;
    try {
      message = await client.beta.messages.stream(withFallback).finalMessage();
    } catch (err) {
      // Some accounts or orgs cannot use server-side fallbacks yet; retry the same request without them.
      if (!(err instanceof Anthropic.BadRequestError) || !/fallback|beta/i.test(apiMessage(err))) throw err;
      console.warn('Retrying without fallbacks:', apiMessage(err));
      message = await client.beta.messages.stream(request).finalMessage();
    }

    if (message.stop_reason === 'refusal') {
      return send(res, 422, { error: 'AI อ่านรูปนี้ไม่ได้ ลองใช้รูปหน้าตารางเรียนจากระบบทะเบียน' });
    }
    if (message.stop_reason === 'max_tokens') {
      return send(res, 422, { error: 'ตารางยาวเกินไป ลองอัปโหลดทีละรูป' });
    }
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return finish(JSON.parse(text));
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'มีคนใช้งานเยอะ ลองใหม่อีกครั้งในอีกสักครู่' });
    if (err instanceof Anthropic.AuthenticationError) return send(res, 500, { error: 'ANTHROPIC_API_KEY ไม่ถูกต้อง ตรวจสอบใน Vercel' });
    if (err instanceof Anthropic.APIError) {
      const detail = apiMessage(err);
      console.error('Claude API error', err.status, detail);
      if (/workspace/i.test(detail)) {
        return send(res, 500, { error: 'API key นี้ไม่ได้ผูกกับ workspace: ตั้งค่า ANTHROPIC_WORKSPACE_ID ใน Vercel หรือสร้าง key ใหม่ภายใน workspace', detail });
      }
      if (/credit balance|billing|purchase credits/i.test(detail)) {
        return send(res, 402, { error: 'เครดิตในบัญชี Anthropic ไม่พอ: เติมเครดิตที่ platform.claude.com → Settings → Billing แล้วลองใหม่', detail });
      }
      if (/model/i.test(detail) && /not found|access|permission|available/i.test(detail)) {
        return send(res, 502, { error: 'บัญชีนี้ยังใช้โมเดล AI ที่ตั้งไว้ไม่ได้', detail });
      }
      if (/image/i.test(detail)) {
        return send(res, 400, { error: 'รูปนี้ใช้ไม่ได้ ลองแคปหน้าจอใหม่เป็น PNG หรือ JPG', detail });
      }
      return send(res, 502, { error: `AI ตอบกลับผิดพลาด (${err.status ?? 'network'})`, detail });
    }
    if (err instanceof SyntaxError) return send(res, 502, { error: 'AI ส่งข้อมูลกลับมาไม่ครบ ลองใหม่อีกครั้ง' });
    console.error(err);
    return send(res, 500, { error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' });
  }
}
