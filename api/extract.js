// Reads timetable screenshots (e.g. from reg.sut.ac.th) with Claude and returns structured classes and exams.
// Needs the ANTHROPIC_API_KEY environment variable in Vercel.
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

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'ใช้ได้เฉพาะ POST' });
  if (!process.env.ANTHROPIC_API_KEY) {
    return send(res, 503, { error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน Vercel (Settings → Environment Variables) แล้ว Redeploy' });
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

  const client = new Anthropic();
  try {
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      return send(res, 422, { error: 'AI อ่านรูปนี้ไม่ได้ ลองใช้รูปหน้าตารางเรียนจากระบบทะเบียน' });
    }
    if (message.stop_reason === 'max_tokens') {
      return send(res, 422, { error: 'ตารางยาวเกินไป ลองอัปโหลดทีละรูป' });
    }
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const data = JSON.parse(text);
    if (!data.is_timetable || !data.classes.length) {
      return send(res, 422, { error: 'ไม่พบตารางเรียนในรูป ลองใช้รูปที่เห็นตารางชัด ๆ', notes: data.notes });
    }
    return send(res, 200, { data });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'มีคนใช้งานเยอะ ลองใหม่อีกครั้งในอีกสักครู่' });
    if (err instanceof Anthropic.AuthenticationError) return send(res, 500, { error: 'ANTHROPIC_API_KEY ไม่ถูกต้อง ตรวจสอบใน Vercel' });
    if (err instanceof Anthropic.APIError) return send(res, 502, { error: `AI ตอบกลับผิดพลาด (${err.status ?? 'network'}) ลองใหม่อีกครั้ง` });
    if (err instanceof SyntaxError) return send(res, 502, { error: 'AI ส่งข้อมูลกลับมาไม่ครบ ลองใหม่อีกครั้ง' });
    console.error(err);
    return send(res, 500, { error: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง' });
  }
}
