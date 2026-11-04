# สมุดตารางเรียน

เว็บเก็บตารางเรียน (มหาลัย) ของแต่ละคน และจัดตารางสอนเด็ก พร้อมเช็คว่าคาบสอนชนกับเวลาเรียนไหม
ข้อมูลเก็บใน Supabase และอัปเดตให้ทุกคนที่เปิดเว็บเห็นทันที (realtime)

## ไฟล์

| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| `index.html` | ตัวเว็บทั้งหมด |
| `api/extract.js` | ส่งรูปตารางไปให้ AI (Gemini หรือ Claude) อ่าน แล้วส่งวิชาและตารางสอบกลับมา |
| `api/class-reminder.js` | เตือนเข้าเรียนล่วงหน้า 30 นาทีทาง Discord |
| `lib/discord.js` | ส่งข้อความไป Discord webhook |
| `api/config.js` | ส่งค่า Supabase URL / anon key จาก Environment Variables ของ Vercel ให้หน้าเว็บ |
| `supabase/schema.sql` | สร้างตารางในฐานข้อมูล เปิดสิทธิ์ และเปิด realtime |

## ตั้งค่า (ครั้งเดียว)

### 1. Supabase (โปรเจกต์ `lttlyffbyomlhvzslscl`)
1. เข้า https://supabase.com/dashboard/project/lttlyffbyomlhvzslscl/sql/new
2. วางเนื้อหาไฟล์ `supabase/schema.sql` แล้วกด **Run** (ทำครั้งเดียว)

URL และ publishable key ใส่ไว้ใน `api/config.js` แล้ว ไม่ต้องตั้งเพิ่ม

### 2. Vercel
1. เข้า https://vercel.com/new แล้ว **Import** repo `oven-ttta/class`
2. Framework Preset: **Other** ไม่ต้องตั้ง Build Command และไม่ต้องใส่ Environment Variables
3. กด **Deploy**

### 3. ระบบอัปโหลดรูปตาราง (AI กรอกให้)
เลือกอย่างใดอย่างหนึ่ง

**แบบฟรี: Google Gemini**
1. สร้าง key ที่ https://aistudio.google.com/apikey (ล็อกอินด้วย Google ไม่ต้องใส่บัตร)
2. ใน Vercel → **Settings → Environment Variables** เพิ่ม `GEMINI_API_KEY` = key ที่ได้
3. กด **Redeploy**

ฟรีแต่มีโควตาต่อนาทีและต่อวัน ถ้าใช้หมดจะขึ้นข้อความให้รอแล้วลองใหม่
ข้อมูลที่ส่งผ่านแบบฟรีอาจถูก Google นำไปใช้ปรับปรุงบริการ
ระบบจะลองทุกโมเดลที่ key ใช้ได้ไล่ไปเรื่อย ๆ (Flash → Flash-Lite → Pro → อื่น ๆ) ตัวไหนตอบได้ก่อนใช้ตัวนั้น
ถ้าอยากให้ลองโมเดลไหนก่อน ตั้ง `GEMINI_MODEL` (คั่นหลายตัวด้วย `,` ได้ ค่าเริ่มต้น `gemini-flash-latest`)

**แบบเสียเงิน: Claude (Anthropic)**
1. สร้าง API key ภายใน workspace ที่ https://platform.claude.com/settings/keys และเติมเครดิตที่ Settings → Billing
2. เพิ่ม `ANTHROPIC_API_KEY` ใน Vercel (ถ้า key ไม่ได้ผูก workspace ให้เพิ่ม `ANTHROPIC_WORKSPACE_ID` ด้วย)
3. กด **Redeploy**

ประมาณ 3–8 บาทต่อการอ่านหนึ่งครั้ง

ถ้าตั้งไว้ทั้งสองแบบ ระบบลอง Gemini ทุกตัวก่อน ถ้าไม่ว่างทั้งหมดจึงใช้ Claude บังคับใช้แค่เจ้าเดียวได้ด้วย `AI_PROVIDER` = `gemini` หรือ `anthropic`

**แบบไม่ต้องตั้งค่าอะไร: OCR ฟรีในเครื่อง**
ในหน้าต่างอัปโหลดมีปุ่ม “อ่านด้วย OCR ฟรี” ใช้ Tesseract.js อ่านรูปในเบราว์เซอร์ ไม่ต้องใช้ key ไม่มีโควตา และไม่ส่งรูปออกไปไหน
ครั้งแรกต้องโหลดตัวอ่านภาษาไทยประมาณ 5 MB อ่านแม่นกับรูปแคปหน้าจอที่ชัด ส่วนรูปจากมือถือที่ตัวหนังสือเล็กให้ใช้ AI แทน

จากนั้นกดปุ่ม “อัปโหลดรูปตาราง (AI กรอกให้)” ใส่ชื่อ เลือกรูปหน้าตารางเรียน/สอบ (สูงสุด 4 รูป) แล้วตรวจข้อมูลก่อนบันทึก

### 4. แจ้งเตือนเข้า Discord ก่อนเข้าเรียน 30 นาที
ระบบส่งแจ้งเตือนอย่างเดียว คือเตือนทุกวิชาที่จะเริ่มในอีก 30 นาที (ตามวัน เวลา และช่วงวันที่เรียนของแต่ละวิชา)

1. ใน Discord: ตั้งค่าห้อง → **Integrations → Webhooks → New Webhook** → **Copy Webhook URL**
2. ใน Vercel เพิ่ม `DISCORD_WEBHOOK_URL` = URL ที่คัดลอก และ `CRON_SECRET` = ข้อความสุ่มยาว ๆ (ทั้งสองตั้งเป็น Secret) แล้ว **Redeploy**
3. Vercel แบบฟรีตั้งเวลาได้แค่วันละครั้ง จึงใช้ https://cron-job.org (ฟรี) เรียกแทน:
   - สมัครแล้วกด **Create cronjob**
   - URL: `https://<เว็บของคุณ>.vercel.app/api/class-reminder?key=<CRON_SECRET>`
   - Execution schedule: **Every 5 minutes**
   - กด **Create**

แต่ละวิชาจะถูกเตือนครั้งเดียว (ระบบแบ่งเวลาเป็นช่วงละ 5 นาที ถ้าตั้งให้เรียกทุก 1 นาทีให้เติม `&every=1` ท้าย URL)
ดูรายการเตือนของวันนี้โดยไม่ส่งจริง: ปุ่ม “ดูรายการเตือนวันนี้” ในกล่องสำรอง/ย้ายข้อมูล หรือเปิด `/api/class-reminder?dry=1`

เปิดเว็บแล้วป้ายด้านบนจะเป็นสีเขียว “ออนไลน์ · อัปเดตเรียลไทม์”
ครั้งแรกที่เปิด เว็บจะใส่ข้อมูลตัวอย่างลงฐานข้อมูลให้เอง

ถ้าต้องการเปลี่ยนไปใช้โปรเจกต์ Supabase อื่น ให้ตั้ง Environment Variables ใน Vercel
`NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (หรือ `SUPABASE_URL` / `SUPABASE_ANON_KEY`)

## หมายเหตุ
- ไม่มีระบบล็อกอิน ใครมีลิงก์เว็บก็ดูและแก้ไขได้
- ถ้าเปิด `index.html` ตรง ๆ โดยไม่ผ่าน Vercel เว็บจะบันทึกข้อมูลไว้ในเบราว์เซอร์เครื่องนั้นแทน
