const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();

// เปิดใช้งาน CORS เพื่อให้หน้าบ้านสามารถส่งข้อมูลมาหาหลังบ้านได้ข้าม Port
app.use(cors());
// ตั้งค่าให้ Server อ่านข้อมูลแบบ JSON ได้
app.use(express.json());

// ⚠️ เชื่อมต่อกับระบบฐานข้อมูลระบบคลาวด์ Neon.tech ของคุณ
const DATABASE_URL = "postgresql://neondb_owner:npg_HuhbzxCdT8v1@ep-jolly-pond-aouhpqco-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

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
// [API 3] สำหรับแอดมิน (admin.html) - เรียกดูประวัติการจองทั้งหมด
// ----------------------------------------------------------------
app.get('/api/bookings', async (req, res) => {
    try {
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

// เปิดพอร์ตทำงานที่เลข 3000
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server กำลังรันที่พอร์ต ${PORT}`);
});