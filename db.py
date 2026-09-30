import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tracker.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # 1. Cards Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        set_code TEXT NOT NULL,
        collector_number TEXT NOT NULL,
        is_foil INTEGER DEFAULT 0,
        qty INTEGER DEFAULT 1,
        scryfall_id TEXT,
        rarity TEXT,
        type_line TEXT,
        mana_cost TEXT,
        image_uri TEXT,
        ck_id INTEGER,
        ck_url TEXT,
        price_retail REAL DEFAULT 0.0,
        price_buy REAL DEFAULT 0.0,
        qty_retail INTEGER DEFAULT 0,
        prev_price_retail REAL DEFAULT 0.0,
        price_change_pct REAL DEFAULT 0.0,
        last_updated TIMESTAMP
    );
    """)
    
    # 2. Price History Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL,
        price_retail REAL NOT NULL,
        price_buy REAL NOT NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (card_id) REFERENCES cards (id) ON DELETE CASCADE
    );
    """)
    
    # 3. Alerts Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER NOT NULL,
        card_name TEXT NOT NULL,
        is_foil INTEGER DEFAULT 0,
        change_type TEXT NOT NULL, -- 'INCREASE' or 'DECREASE'
        old_price REAL NOT NULL,
        new_price REAL NOT NULL,
        change_pct REAL NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_read INTEGER DEFAULT 0,
        FOREIGN KEY (card_id) REFERENCES cards (id) ON DELETE CASCADE
    );
    """)
    
    # 4. Sales Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id INTEGER,
        card_name TEXT NOT NULL,
        set_code TEXT,
        collector_number TEXT,
        is_foil INTEGER DEFAULT 0,
        image_uri TEXT,
        qty_sold INTEGER DEFAULT 1,
        sold_price_usd REAL NOT NULL,
        sold_price_thb REAL NOT NULL,
        ck_retail_at_sale REAL DEFAULT 0.0,
        buyer_note TEXT,
        exchange_rate REAL DEFAULT 0.0,
        sold_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    try:
        cursor.execute("ALTER TABLE sales ADD COLUMN exchange_rate REAL DEFAULT 0.0")
    except sqlite3.OperationalError:
        pass

    # 5. Boxes / Opening Rounds Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS boxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        set_code TEXT NOT NULL,
        box_cost_thb REAL DEFAULT 4800.0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Seed default box for Box 1 if not exists
    cursor.execute("""
    INSERT OR IGNORE INTO boxes (id, name, set_code, box_cost_thb, notes)
    VALUES (1, 'รอบที่ 1 (Box #1)', 'fra', 4800.0, 'Play Booster Box FRA #1 - ต้นทุน 4,800 บาท')
    """)

    # Migrations for cards and sales table to have box_id
    try:
        cursor.execute("ALTER TABLE cards ADD COLUMN box_id INTEGER DEFAULT 1")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE sales ADD COLUMN box_id INTEGER DEFAULT 1")
    except sqlite3.OperationalError:
        pass

    cursor.execute("UPDATE cards SET box_id = 1 WHERE box_id IS NULL")
    cursor.execute("UPDATE sales SET box_id = 1 WHERE box_id IS NULL")

    # 6. Set Costs Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS set_costs (
        set_code TEXT PRIMARY KEY,
        set_name TEXT NOT NULL,
        box_count INTEGER DEFAULT 1,
        cost_per_box_thb REAL DEFAULT 0.0,
        total_cost_thb REAL DEFAULT 0.0,
        notes TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # Seed default box cost for FRA if not exists
    cursor.execute("""
    INSERT OR IGNORE INTO set_costs (set_code, set_name, box_count, cost_per_box_thb, total_cost_thb, notes)
    VALUES ('fra', 'Reality Fracture', 1, 4800.0, 4800.0, 'ซื้อบ็อกมาเปิด 4,800 บาท')
    """)

    # 6. Settings Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)
    
    # Default settings
    default_settings = [
        ("thb_rate", "34.0"),
        ("alert_threshold_pct", "5.0"),
        ("auto_sync_interval_mins", "30")
    ]
    for key, val in default_settings:
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, val))
        
    conn.commit()
    conn.close()

def get_setting(key, default=None):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else default

def set_setting(key, value):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(value)))
    conn.commit()
    conn.close()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at:", DB_PATH)
