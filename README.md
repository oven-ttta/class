# สมุดตารางเรียน

เว็บเก็บตารางเรียน (มหาลัย) ของแต่ละคน และจัดตารางสอนเด็ก พร้อมเช็คว่าคาบสอนชนกับเวลาเรียนไหม
ข้อมูลเก็บใน Supabase และอัปเดตให้ทุกคนที่เปิดเว็บเห็นทันที (realtime)

## ไฟล์

| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| `index.html` | ตัวเว็บทั้งหมด |
| `api/extract.js` | ส่งรูปตารางไปให้ Claude อ่าน แล้วส่งวิชาและตารางสอบกลับมา |
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
1. สร้าง API key ที่ https://platform.claude.com/settings/keys
2. ใน Vercel → Project → **Settings → Environment Variables** เพิ่ม `ANTHROPIC_API_KEY` = key ที่ได้
3. ถ้า key ไม่ได้สร้างภายใน workspace (ขึ้นข้อความเรื่อง workspace) ให้เพิ่ม `ANTHROPIC_WORKSPACE_ID` = ID ของ workspace (ขึ้นต้นด้วย `wrkspc_`) ด้วย
4. กด **Redeploy**

จากนั้นกดปุ่ม “อัปโหลดรูปตาราง (AI กรอกให้)” ใส่ชื่อ เลือกรูปหน้าตารางเรียน/สอบ (สูงสุด 4 รูป) แล้วตรวจข้อมูลก่อนบันทึก
ค่าใช้จ่ายคิดตามการใช้งาน API ของ Anthropic (ประมาณ 3–8 บาทต่อการอ่านหนึ่งครั้ง ขึ้นกับจำนวนรูปและจำนวนวิชา)

เปิดเว็บแล้วป้ายด้านบนจะเป็นสีเขียว “ออนไลน์ · อัปเดตเรียลไทม์”
ครั้งแรกที่เปิด เว็บจะใส่ข้อมูลตัวอย่างลงฐานข้อมูลให้เอง

ถ้าต้องการเปลี่ยนไปใช้โปรเจกต์ Supabase อื่น ให้ตั้ง Environment Variables ใน Vercel
`NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (หรือ `SUPABASE_URL` / `SUPABASE_ANON_KEY`)

## หมายเหตุ
- ไม่มีระบบล็อกอิน ใครมีลิงก์เว็บก็ดูและแก้ไขได้
- ถ้าเปิด `index.html` ตรง ๆ โดยไม่ผ่าน Vercel เว็บจะบันทึกข้อมูลไว้ในเบราว์เซอร์เครื่องนั้นแทน
