# MTG Card Kingdom (CKD) Tracker & Box Opening Dashboard

แดชบอร์ดติดตามราคาการ์ด Magic: The Gathering จาก Card Kingdom (CKD) และ Scryfall พร้อมระบบบันทึกสต็อก แยกชุดตามรอบเปิดบ็อก (Box Opening Batches), คำนวณต้นทุน, กำไร/ขาดทุน และอัตราผลตอบแทน (ROI) แยกรายบ็อกแบบ Real-time

---

## 🚀 วิธีการ Deploy ขึ้น Cloud Host ฟรี (เปิดดูได้ตลอดเวลาจากมือถือ)

มี 2 ทางเลือกหลักที่ฟรีและรองรับ Python + Database:

---

### ทางเลือกที่ 1: PythonAnywhere (⭐ แนะนำที่สุด — ฐานข้อมูล SQLite อยู่ถาวร 100%)

PythonAnywhere ให้โฮสติ้งฟรีสำหรับ Python และมี **Persistent Disk (ฮาร์ดดิสก์ถาวร)** สำหรับ SQLite `tracker.db` ทำให้ข้อมูลการ์ดและประวัติการขายไม่หายแม้รีสตาร์ทเซิร์ฟเวอร์

#### ขั้นตอนการติดตั้ง:
1. **สมัครบัญชีฟรี**: เข้าไปที่ [pythonanywhere.com](https://www.pythonanywhere.com) แล้วสมัครบัญชี Beginner (ฟรี)
2. **เปิด Bash Console**:
   * ไปที่แท็บ **Consoles** -> คลิก **Bash**
3. **โคลนโปรเจกต์จาก GitHub**:
   ```bash
   git clone https://github.com/YOUR_GITHUB_USERNAME/mtg-tracker.git
   cd mtg-tracker
   pip install --user -r requirements.txt
   ```
4. **ตั้งค่า Web App**:
   * ไปที่แท็บ **Web** ด้านบน -> คลิก **Add a new web app**
   * เลือก **Manual configuration** -> เลือก **Python 3.10** (หรือเวอร์ชันล่าสุด)
   * เลื่อนลงมาที่หัวข้อ **Code**:
     * **Source code**: ใส่ `/home/YOUR_USERNAME/mtg-tracker`
     * **Working directory**: ใส่ `/home/YOUR_USERNAME/mtg-tracker`
   * คลิกที่ลิงก์ไฟล์ **WSGI configuration file** (เช่น `/var/www/YOUR_USERNAME_pythonanywhere_com_wsgi.py`)
   * ลบเนื้อหาเดิมทั้งหมด แล้วใส่โค้ดนี้:
     ```python
     import sys
     import os

     path = '/home/YOUR_USERNAME/mtg-tracker'
     if path not in sys.path:
         sys.path.append(path)

     from app import app as application
     ```
     *(เปลี่ยน `YOUR_USERNAME` เป็นชื่อผู้ใช้ของคุณ)*
   * กดปุ่ม **Save** ด้านบนขวา
5. **รีโหลดเว็บ**:
   * กลับมาที่แท็บ **Web** แล้วคลิกปุ่มสีเขียว **Reload YOUR_USERNAME.pythonanywhere.com**
   * เสร็จแล้ว! เข้าดูเว็บของคุณได้ที่ `https://YOUR_USERNAME.pythonanywhere.com`

---

### ทางเลือกที่ 2: Render.com (Deploy อัตโนมัติเมื่อ Push ขึ้น GitHub)

Render จะเชื่อมกับ GitHub Repo ของคุณโดยตรง ทุกครั้งที่มีการ `git push` โค้ดจะอัปเดตให้อัตโนมัติ

#### ขั้นตอนการติดตั้ง:
1. นำโค้ดขึ้น GitHub Repo ของคุณ
2. สมัครบัญชีฟรีที่ [render.com](https://render.com)
3. คลิก **New +** -> เลือก **Web Service**
4. เชื่อมต่อกับ GitHub Repo `mtg-tracker` ของคุณ
5. ตั้งค่าดังนี้:
   * **Name**: `mtg-tracker` (หรือชื่อที่คุณต้องการ)
   * **Region**: Singapore (ใกล้ไทย เร็วสุด)
   * **Branch**: `main`
   * **Runtime**: `Python 3`
   * **Build Command**: `pip install -r requirements.txt`
   * **Start Command**: `gunicorn app:app --bind 0.0.0.0:$PORT`
   * **Instance Type**: `Free`
6. คลิก **Create Web Service** -> รอระบบ Build ประมาณ 1-2 นาที
7. คุณจะได้ URL เช่น `https://mtg-tracker.onrender.com` ใช้งานได้ทันที!

> **หมายเหตุสำหรับ Render Free Tier**: บนแพ็กเกจฟรี ฮาร์ดดิสก์เป็นแบบชั่วคราว (Ephemeral) หากแอปหลับหลังไม่มีผู้เข้าชม 15 นาที ข้อมูล SQLite จะถูกรีเซ็ตกลับไปยังสถานะล่าสุดใน Git Repo จึงแนะนำให้ Commit `tracker.db` ขึ้น GitHub หากต้องการบันทึกสถานะล่าสุด หรือใช้ **PythonAnywhere** ตามทางเลือกที่ 1 ที่มีฮาร์ดดิสก์ถาวรให้ฟรี

---

## 💻 วิธีการรันในเครื่องตัวเอง (Local Development)

```bash
# 1. ติดตั้ง Dependencies
pip install -r requirements.txt

# 2. รันแอปพลิเคชัน
python3 app.py

# 3. เปิดเว็บเบราว์เซอร์
http://localhost:5055
```
