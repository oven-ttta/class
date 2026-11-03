# สมุดตารางเรียน

เว็บเก็บตารางเรียน (มหาลัย) ของแต่ละคน และจัดตารางสอนเด็ก พร้อมเช็คว่าคาบสอนชนกับเวลาเรียนไหม
ข้อมูลเก็บใน Supabase และอัปเดตให้ทุกคนที่เปิดเว็บเห็นทันที (realtime)

## ไฟล์

| ไฟล์ | ใช้ทำอะไร |
| --- | --- |
| `index.html` | ตัวเว็บทั้งหมด |
| `api/config.js` | ส่งค่า Supabase URL / anon key จาก Environment Variables ของ Vercel ให้หน้าเว็บ |
| `supabase/schema.sql` | สร้างตารางในฐานข้อมูล เปิดสิทธิ์ และเปิด realtime |

## ตั้งค่า (ครั้งเดียว)

### 1. Supabase
1. สมัคร / เข้า https://supabase.com แล้วกด **New project**
2. เข้าเมนู **SQL Editor** → **New query** วางเนื้อหาไฟล์ `supabase/schema.sql` แล้วกด **Run**
3. เข้า **Project Settings → API** จดค่า **Project URL** และ **anon public key**

### 2. Vercel
1. เข้า https://vercel.com/new แล้ว **Import** repo `oven-ttta/class` (เลือก branch นี้หรือ merge เข้า main ก่อน)
2. Framework Preset: **Other** ไม่ต้องตั้ง Build Command
3. ในหัวข้อ **Environment Variables** ใส่
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon public key
4. กด **Deploy**

เปิดเว็บแล้วป้ายด้านบนจะเป็นสีเขียว “ออนไลน์ · อัปเดตเรียลไทม์”
ครั้งแรกที่เปิด เว็บจะใส่ข้อมูลตัวอย่างลงฐานข้อมูลให้เอง

## หมายเหตุ
- ไม่มีระบบล็อกอิน ใครมีลิงก์เว็บก็ดูและแก้ไขได้
- ถ้าเปิด `index.html` ตรง ๆ โดยไม่ผ่าน Vercel เว็บจะบันทึกข้อมูลไว้ในเบราว์เซอร์เครื่องนั้นแทน
