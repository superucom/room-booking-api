const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();

// เปิดใช้งาน CORS เพื่อให้หน้าบ้านสามารถส่งข้อมูลมาหาหลังบ้านได้ข้าม Port
app.use(cors());
// ตั้งค่าให้ Server อ่านข้อมูลแบบ JSON ได้
app.use(express.json());

// ⚠️ เชื่อมต่อกับระบบฐานข้อมูลระบบคลาวด์ Neon.tech ของคุณ
const DATABASE_URL = process.env.DATABASE_URL;

const db = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ----------------------------------------------------------------
// [API 1] สำหรับหน้าแรก (index.html) - เช็กห้องว่างตามวันและเวลา
// ----------------------------------------------------------------
app.get('/api/available-rooms', async (req, res) => {
    const { date, slot } = req.query;
    if (!date || !slot) {
        return res.status(400).json({ error: 'กรุณาระบุข้อมูลวันที่และช่วงเวลาให้ครบถ้วน' });
    }
    try {
        const queryText = `
      SELECT room_id, room_name FROM rooms 
      WHERE room_id NOT IN (
        SELECT room_id FROM bookings WHERE booking_date = $1 AND time_slot = $2
      ) ORDER BY room_id ASC
    `;
        const result = await db.query(queryText, [date, slot]);
        res.json({ availableRooms: result.rows });
    } catch (err) {
        console.error('Error fetching available rooms:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลห้องพักจากฐานข้อมูล' });
    }
});

// ----------------------------------------------------------------
// [API 2] สำหรับหน้าแรก (index.html) - บันทึกการจองลงฐานข้อมูล
// ----------------------------------------------------------------
app.post('/api/book', async (req, res) => {
    const { emp_id, room_id, date, slot } = req.body;
    if (!emp_id || !room_id || !date || !slot) {
        return res.status(400).json({ error: 'กรุณากรอกข้อมูลพนักงานและเลือกห้องพักให้ครบถ้วน' });
    }
    try {
        // ตรวจสอบว่าห้องพักนั้นถูกผู้อื่นจองไปแล้วในวันเวลาเดียวกันหรือไม่
        const checkRoom = await db.query(
            'SELECT booking_id FROM bookings WHERE booking_date = $1 AND time_slot = $2 AND room_id = $3',
            [date, slot, room_id]
        );
        if (checkRoom.rows.length > 0) {
            return res.status(400).json({ error: 'ห้องพักเป้าหมายถูกจองโดยบุคคลอื่นไปแล้วก่อนหน้านี้' });
        }

        // ตรวจสอบว่าพนักงานคนนี้ได้จองห้องอื่นในช่วงเวลาเดียวกันไปแล้วหรือไม่
        const checkEmp = await db.query(
            'SELECT booking_id FROM bookings WHERE booking_date = $1 AND time_slot = $2 AND emp_id = $3',
            [date, slot, emp_id]
        );
        if (checkEmp.rows.length > 0) {
            return res.status(400).json({ error: 'พนักงานรหัสนี้มีคิวจองห้องพักห้องอื่นในช่วงเวลานี้แล้ว' });
        }

        // บันทึกการจอง
        const insertQuery = 'INSERT INTO bookings (emp_id, room_id, booking_date, time_slot) VALUES ($1, $2, $3, $4) RETURNING *';
        const newBooking = await db.query(insertQuery, [emp_id, room_id, date, slot]);
        res.status(201).json({ message: 'ลงทะเบียนจองห้องพักสำเร็จ!', data: newBooking.rows[0] });
    } catch (err) {
        console.error('Error inserting booking:', err);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'ข้อมูลการจองซ้ำซ้อน กรุณาทำรายการใหม่อีกครั้ง' });
        }
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูลภายในเซิร์ฟเวอร์' });
    }
});

// ----------------------------------------------------------------
// // [API 3] สำหรับแอดมิน (admin.html) และพนักงาน (index.html) - เรียกดูประวัติการจองทั้งหมด
// // -------------------------------------------------------------
app.get('/api/bookings', async (req, res) => {
    // 1. รับค่าชื่อพนักงานที่ส่งมาจากหน้าบ้าน (ถ้ามี)
    const { emp_name } = req.query;

    try {
        // 2. ตรวจสอบว่าพนักงานคนนี้ติดแบล็กลิสต์หรือไม่ (ตรวจสอบเฉพาะเมื่อมีการส่งชื่อมา)
        if (emp_name) {
            const blacklistCheck = await db.query('SELECT 1 FROM blacklist WHERE emp_name = $1', [emp_name.trim()]);

            // 🚨 ตรวจเจอว่าชื่อนี้ติดแบล็กลิสต์! ส่งตารางจำลอง "ห้องเต็ม" กลับไปหลอกทันที
            if (blacklistCheck.rowCount > 0) {
                const fakeFullBookings = [];
                const rooms = ['ห้องพักเบรค 1', 'ห้องพักเบรค 2', 'ห้องพักเบรค 3', 'ห้องพักเบรค 4', 'ห้องพักเบรค 5', 'ห้องพักเบรค 6'];
                const slots = ['1', '3', '5', '6'];

                rooms.forEach(room => {
                    slots.forEach(slot => {
                        fakeFullBookings.push({
                            booking_id: 999999, // เลขสมมติ
                            emp_id: 'เต็ม',
                            emp_name: 'เต็ม',
                            room_name: room,
                            booking_date: new Date().toISOString().split('T')[0], // วันที่ปัจจุบัน
                            time_slot: slot
                        });
                    });
                });

                return res.json(fakeFullBookings); // ส่งตารางหลอกกลับไปและจบการทำงาน
            }
        }

        // 🟢 3. หากเป็นพนักงานปกติ หรือหน้าแอดมินดึงข้อมูล (ไม่มี emp_name แนบมา) ให้ดึงข้อมูลจริงตามปกติ
        const queryText = `
            SELECT b.booking_id, b.emp_id, b.room_id, r.room_name, b.booking_date, b.time_slot
            FROM bookings b
            LEFT JOIN rooms r ON b.room_id = r.room_id
            ORDER BY b.booking_date DESC, b.time_slot DESC, b.booking_id DESC
        `;

        const result = await db.query(queryText);
        res.json(result.rows);

    } catch (err) {
        console.error('Error fetching bookings:', err);
        res.status(500).json({ error: 'ไม่สามารถดึงข้อมูลคิวการจองพักเบรคได้' });
    }
});

// ----------------------------------------------------------------
// [API 4] สำหรับแอดมิน (admin.html) - ลบประวัติการจอง (ยกเลิกสิทธิ์)
// ----------------------------------------------------------------
app.delete('/api/bookings/:id', async (req, res) => {
    const bookingId = req.params.id;
    try {
        const result = await db.query('DELETE FROM bookings WHERE booking_id = $1 RETURNING *', [bookingId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'ไม่พบรายการคิวจองที่ต้องการทำรายการลบ' });
        }
        res.json({ message: 'ลบรายการและคืนสิทธิ์ห้องว่างเรียบร้อยแล้ว!', deletedBooking: result.rows[0] });
    } catch (err) {
        console.error('Error deleting booking:', err);
        res.status(500).json({ error: 'ไม่สามารถยกเลิกรายการจองในฐานข้อมูลได้' });
    }
});

app.post('/api/admin-login', (req, res) => {
    const { username, password } = req.body;

    // 💡 สามารถแก้ไข Username และ Password ที่ต้องการให้แอดมินใช้กรอกตรงนี้ได้เลยครับ
    if (username === 'Super' && password === 'teamb123') {
        res.json({ success: true, message: 'ยืนยันสิทธิ์แอดมินสำเร็จ' });
    } else {
        res.status(401).json({ success: false, error: 'ชื่อผู้ใช้งาน หรือ รหัสผ่านแอดมินไม่ถูกต้อง!' });
    }
});

// ==========================================
// 🛡️ API สำหรับระบบแบล็กลิสต์ (ชื่อพนักงาน)
// ==========================================

// 1. GET: ดึงรายชื่อแบล็กลิสต์ทั้งหมดไปแสดงบนตาราง
app.get('/api/blacklist', async (req, res) => {
    try {
        //  แก้ไขจาก pool.query เป็น db.query
        const result = await db.query('SELECT * FROM blacklist ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching blacklist:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลแบล็กลิสต์' });
    }
});

// 2. POST: บันทึกชื่อพนักงานเข้าแบล็กลิสต์
app.post('/api/blacklist', async (req, res) => {
    const { emp_name, reason } = req.body;
    if (!emp_name) return res.status(400).json({ error: 'กรุณาระบุชื่อพนักงาน' });

    try {
        //  แก้ไขจาก pool.query เป็น db.query
        await db.query(
            'INSERT INTO blacklist (emp_name, reason) VALUES ($1, $2) ON CONFLICT (emp_name) DO UPDATE SET reason = $2',
            [emp_name.trim(), reason || '']
        );
        res.json({ success: true, message: 'บันทึกรายชื่อแบล็กลิสต์เรียบร้อยแล้ว' });
    } catch (err) {
        console.error('Error inserting blacklist:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการบันทึกแบล็กลิสต์' });
    }
});

// 3. DELETE: ลบชื่อพนักงานออกจากแบล็กลิสต์ (ปลดบล็อก)
app.delete('/api/blacklist/:emp_name', async (req, res) => {
    const { emp_name } = req.params;
    try {
        //  แก้ไขจาก pool.query เป็น db.query
        await db.query('DELETE FROM blacklist WHERE emp_name = $1', [decodeURIComponent(emp_name).trim()]);
        res.json({ success: true, message: 'ลบรายชื่อออกจากแบล็กลิสต์แล้ว' });
    } catch (err) {
        console.error('Error deleting blacklist:', err);
        res.status(500).json({ error: 'เกิดข้อผิดพลาดในการลบแบล็กลิสต์' });
    }
});

// เปิดพอร์ตทำงานที่เลข 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(` Server กำลังออนไลน์บนคลาวด์ที่พอร์ต ${PORT}`);
});
