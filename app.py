import os
import threading
import time
import csv
import io
import json
import urllib.request
import urllib.parse
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, Response
from db import get_connection, init_db, get_setting, set_setting
from ck_sync import sync_card_prices, get_ck_pricelist
from seed_cards import parse_moxfield_text, fetch_scryfall_metadata

app = Flask(__name__, static_folder="static")

# Background sync scheduler
def background_sync_worker():
    while True:
        try:
            interval_str = get_setting("auto_sync_interval_mins", "30")
            interval_mins = max(5, int(interval_str))
        except (ValueError, TypeError):
            interval_mins = 30
            
        time.sleep(interval_mins * 60)
        try:
            print(f"[AUTO_SYNC] Starting scheduled Card Kingdom price sync ({datetime.now()})...")
            sync_card_prices(force_download=False)
        except Exception as e:
            print(f"[AUTO_SYNC] Error during sync: {e}")

# Routes
@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

@app.route("/api/cards", methods=["GET"])
def get_cards():
    conn = get_connection()
    cursor = conn.cursor()
    
    # Query parameters for sorting and filtering
    sort_by = request.args.get("sort", "price_desc")
    rarity = request.args.get("rarity", "")
    is_foil = request.args.get("foil", "")
    search = request.args.get("q", "").strip().lower()
    set_code = request.args.get("set_code", "").strip().lower()
    box_id = request.args.get("box_id", "").strip()
    
    query = """
        SELECT cards.*, boxes.name as box_name, boxes.box_cost_thb 
        FROM cards 
        LEFT JOIN boxes ON cards.box_id = boxes.id 
        WHERE 1=1
    """
    params = []
    
    if box_id:
        query += " AND cards.box_id = ?"
        params.append(int(box_id))
    elif set_code:
        query += " AND cards.set_code = ?"
        params.append(set_code)

    if rarity:
        query += " AND cards.rarity = ?"
        params.append(rarity.lower())
    if is_foil != "":
        query += " AND cards.is_foil = ?"
        params.append(1 if is_foil.lower() in ["1", "true"] else 0)
    if search:
        query += " AND (LOWER(cards.name) LIKE ? OR LOWER(cards.type_line) LIKE ?)"
        params.append(f"%{search}%")
        params.append(f"%{search}%")
        
    if sort_by == "price_desc":
        query += " ORDER BY cards.price_retail DESC"
    elif sort_by == "price_asc":
        query += " ORDER BY cards.price_retail ASC"
    elif sort_by == "name_asc":
        query += " ORDER BY cards.name ASC"
    elif sort_by == "change_desc":
        query += " ORDER BY cards.price_change_pct DESC"
    elif sort_by == "change_asc":
        query += " ORDER BY cards.price_change_pct ASC"
    else:
        query += " ORDER BY cards.price_retail DESC"
        
    cursor.execute(query, params)
    cards = [dict(row) for row in cursor.fetchall()]
    
    # Calculate portfolio summary (scoped to box_id or set_code if filtered)
    if box_id:
        b_id = int(box_id)
        cursor.execute("SELECT * FROM cards WHERE box_id = ?", (b_id,))
        all_cards = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT COUNT(*) as count, SUM(sold_price_usd * qty_sold) as total_usd, SUM(sold_price_thb * qty_sold) as total_thb FROM sales WHERE box_id = ?", (b_id,))
        sales_row = cursor.fetchone()
        cursor.execute("SELECT * FROM boxes WHERE id = ?", (b_id,))
        box_row = cursor.fetchone()
        box_cost_thb = float(box_row["box_cost_thb"] or 0.0) if box_row else 0.0
        box_count = 1
        box_notes = box_row["notes"] or "" if box_row else ""
        box_name = box_row["name"] if box_row else ""
    elif set_code:
        cursor.execute("SELECT * FROM cards WHERE set_code = ?", (set_code,))
        all_cards = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT COUNT(*) as count, SUM(sold_price_usd * qty_sold) as total_usd, SUM(sold_price_thb * qty_sold) as total_thb FROM sales WHERE set_code = ?", (set_code,))
        sales_row = cursor.fetchone()
        cursor.execute("SELECT SUM(box_cost_thb) as total_cost, COUNT(*) as box_count FROM boxes WHERE set_code = ?", (set_code,))
        box_costs_agg = cursor.fetchone()
        box_cost_thb = float(box_costs_agg["total_cost"] or 0.0) if box_costs_agg else 0.0
        box_count = int(box_costs_agg["box_count"] or 0) if box_costs_agg else 0
        box_notes = f"{box_count} บ็อก"
        box_name = set_code.upper()
    else:
        cursor.execute("SELECT * FROM cards")
        all_cards = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT COUNT(*) as count, SUM(sold_price_usd * qty_sold) as total_usd, SUM(sold_price_thb * qty_sold) as total_thb FROM sales")
        sales_row = cursor.fetchone()
        cursor.execute("SELECT SUM(box_cost_thb) as total_cost, COUNT(*) as box_count FROM boxes")
        box_costs_agg = cursor.fetchone()
        box_cost_thb = float(box_costs_agg["total_cost"] or 0.0) if box_costs_agg else 0.0
        box_count = int(box_costs_agg["box_count"] or 0) if box_costs_agg else 0
        box_notes = f"{box_count} บ็อกทั้งหมด"
        box_name = "ทั้งหมด"
    
    thb_rate = float(get_setting("thb_rate", "34.0"))
    
    total_retail_usd = sum(c["price_retail"] * c["qty"] for c in all_cards)
    total_buy_usd = sum(c["price_buy"] * c["qty"] for c in all_cards)
    total_cards_count = sum(c["qty"] for c in all_cards)
    
    # Top gainer and loser
    gainers = [c for c in all_cards if c["price_change_pct"] > 0]
    losers = [c for c in all_cards if c["price_change_pct"] < 0]
    
    top_gainer = max(gainers, key=lambda x: x["price_change_pct"]) if gainers else None
    top_loser = min(losers, key=lambda x: x["price_change_pct"]) if losers else None
    
    # Unread alerts count
    cursor.execute("SELECT COUNT(*) as unread FROM alerts WHERE is_read = 0")
    unread_alerts = cursor.fetchone()["unread"]

    # Sales metrics
    total_sold_count = sales_row["count"] or 0
    total_sold_usd = round(sales_row["total_usd"] or 0.0, 2)
    total_sold_thb = round(sales_row["total_thb"] or 0.0, 2)
    
    total_retail_thb = round(total_retail_usd * thb_rate, 2)
    net_realized_and_pulled_thb = round(total_retail_thb + total_sold_thb, 2)
    roi_thb = round(net_realized_and_pulled_thb - box_cost_thb, 2)
    roi_pct = round(((net_realized_and_pulled_thb / box_cost_thb) - 1.0) * 100.0, 1) if box_cost_thb > 0 else 0.0
    is_breakeven = (net_realized_and_pulled_thb >= box_cost_thb) and (box_cost_thb > 0)
    
    conn.close()
    
    return jsonify({
        "cards": cards,
        "selected_set": set_code,
        "selected_box_id": box_id,
        "summary": {
            "total_unique": len(all_cards),
            "total_count": total_cards_count,
            "total_retail_usd": round(total_retail_usd, 2),
            "total_retail_thb": total_retail_thb,
            "total_buy_usd": round(total_buy_usd, 2),
            "total_buy_thb": round(total_buy_usd * thb_rate, 2),
            "total_sold_count": total_sold_count,
            "total_sold_usd": total_sold_usd,
            "total_sold_thb": total_sold_thb,
            "box_cost_thb": box_cost_thb,
            "box_count": box_count,
            "box_notes": box_notes,
            "box_name": box_name,
            "roi_thb": roi_thb,
            "roi_pct": roi_pct,
            "is_breakeven": is_breakeven,
            "thb_rate": thb_rate,
            "top_gainer": top_gainer,
            "top_loser": top_loser,
            "unread_alerts": unread_alerts
        }
    })

@app.route("/api/cards", methods=["POST"])
def add_cards():
    data = request.json or {}
    raw_text = data.get("text", "")
    
    if not raw_text.strip():
        return jsonify({"error": "No card text provided"}), 400
        
    parsed = parse_moxfield_text(raw_text)
    if not parsed:
        return jsonify({"error": "Could not parse any cards. Use format: 1 Card Name (SET) 123"}), 400
        
    scryfall_map = fetch_scryfall_metadata(parsed)
    box_id_param = data.get("box_id")
    create_new_box = data.get("create_new_box", False)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    target_box_id = 1
    if create_new_box:
        new_box_name = data.get("new_box_name", "").strip()
        new_box_set = data.get("new_box_set", "").strip().lower() or "fra"
        new_box_cost = float(data.get("new_box_cost", 4800.0))
        new_box_notes = data.get("new_box_notes", "").strip()
        if not new_box_name:
            cursor.execute("SELECT COUNT(*) FROM boxes")
            count = cursor.fetchone()[0] + 1
            new_box_name = f"รอบที่ {count} (Box #{count})"
        cursor.execute("""
            INSERT INTO boxes (name, set_code, box_cost_thb, notes)
            VALUES (?, ?, ?, ?)
        """, (new_box_name, new_box_set, new_box_cost, new_box_notes))
        target_box_id = cursor.lastrowid
    elif box_id_param:
        target_box_id = int(box_id_param)
        
    added_count = 0
    for c in parsed:
        scry_data = None
        if c["set_code"] and c["collector_number"]:
            scry_data = scryfall_map.get((c["set_code"], c["collector_number"].lower()))
        if not scry_data and c["set_code"]:
            scry_data = scryfall_map.get((c["set_code"], ""))
        if not scry_data:
            scry_data = scryfall_map.get(c["name"].lower())
            
        name = scry_data.get("name", c["name"]) if scry_data else c["name"]
        set_code = (scry_data.get("set") if scry_data and scry_data.get("set") else (c["set_code"] or "fra")).lower()
        col_num = str(scry_data.get("collector_number") if scry_data and scry_data.get("collector_number") else (c["collector_number"] or "1")).lower()
        
        scryfall_id = None
        rarity = "common"
        type_line = ""
        mana_cost = ""
        image_uri = ""
        
        if scry_data:
            scryfall_id = scry_data.get("id")
            rarity = scry_data.get("rarity", "common")
            type_line = scry_data.get("type_line", "")
            mana_cost = scry_data.get("mana_cost", "")
            if "image_uris" in scry_data:
                image_uri = scry_data["image_uris"].get("normal")
            elif "card_faces" in scry_data and len(scry_data["card_faces"]) > 0:
                image_uri = scry_data["card_faces"][0].get("image_uris", {}).get("normal", "")
                
        cursor.execute("""
            SELECT id, qty FROM cards 
            WHERE set_code = ? AND collector_number = ? AND is_foil = ? AND box_id = ?
        """, (set_code, col_num, c["is_foil"], target_box_id))
        row = cursor.fetchone()
        
        if row:
            cursor.execute("UPDATE cards SET qty = qty + ? WHERE id = ?", (c["qty"], row["id"]))
        else:
            cursor.execute("""
                INSERT INTO cards (
                    name, set_code, collector_number, is_foil, qty,
                    scryfall_id, rarity, type_line, mana_cost, image_uri, box_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                name, set_code, col_num, c["is_foil"], c["qty"],
                scryfall_id, rarity, type_line, mana_cost, image_uri, target_box_id
            ))
            added_count += 1
            
    conn.commit()
    conn.close()
    
    # Sync prices for new cards
    sync_card_prices(force_download=False, populate_initial_history=True)
    
    return jsonify({
        "success": True, 
        "added_count": added_count, 
        "total_parsed": len(parsed),
        "box_id": target_box_id
    })

@app.route("/api/cards/<int:card_id>", methods=["DELETE"])
def delete_card(card_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    cursor.execute("DELETE FROM price_history WHERE card_id = ?", (card_id,))
    cursor.execute("DELETE FROM alerts WHERE card_id = ?", (card_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/cards/<int:card_id>/qty", methods=["POST"])
def update_qty(card_id):
    data = request.json or {}
    new_qty = int(data.get("qty", 1))
    conn = get_connection()
    cursor = conn.cursor()
    if new_qty <= 0:
        cursor.execute("DELETE FROM cards WHERE id = ?", (card_id,))
        cursor.execute("DELETE FROM price_history WHERE card_id = ?", (card_id,))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "qty": 0, "deleted": True})
    else:
        cursor.execute("UPDATE cards SET qty = ? WHERE id = ?", (new_qty, card_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "qty": new_qty, "deleted": False})

CARD_VARIANTS_CACHE = {}

@app.route("/api/cards/<int:card_id>/variants", methods=["GET"])
def get_card_variants_route(card_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM cards WHERE id = ?", (card_id,))
    card = cursor.fetchone()
    conn.close()
    
    if not card:
        return jsonify({"error": "Card not found"}), 404
        
    card_dict = dict(card)
    card_name = card_dict["name"]
    # Handle split/double face names like "Bloodline Recollector // Ancestral Craving"
    search_name = card_name.split("//")[0].strip()
    set_code = card_dict["set_code"].lower()
    
    cache_key = (search_name.lower(), set_code)
    force_refresh = request.args.get("refresh") == "1"
    variants = None
    if not force_refresh and cache_key in CARD_VARIANTS_CACHE:
        variants = CARD_VARIANTS_CACHE[cache_key]
        
    if variants is None:
        try:
            ck_items = get_ck_pricelist(force_download=False)
        except Exception as e:
            print(f"[VARIANTS] Error loading CK pricelist: {e}")
            ck_items = []

        ck_by_scryfall = {}
        for it in ck_items:
            sid = str(it.get("scryfall_id", "")).lower()
            is_f = (str(it.get("is_foil")).lower() == "true")
            if sid:
                ck_by_scryfall[(sid, is_f)] = it

        query = f"!\"{search_name}\" set:{set_code} unique:prints"
        url = "https://api.scryfall.com/cards/search?" + urllib.parse.urlencode({"q": query})
        headers = {"User-Agent": "MTGPriceTracker/1.0", "Accept": "application/json"}
        req = urllib.request.Request(url, headers=headers)
        
        cards_data = []
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode())
                cards_data = data.get("data", [])
        except Exception as e:
            print(f"[VARIANTS] Scryfall set query error for {search_name}: {e}")
            try:
                query_fallback = f"!\"{search_name}\" unique:prints"
                url_fallback = "https://api.scryfall.com/cards/search?" + urllib.parse.urlencode({"q": query_fallback})
                req_fallback = urllib.request.Request(url_fallback, headers=headers)
                with urllib.request.urlopen(req_fallback) as resp:
                    data = json.loads(resp.read().decode())
                    cards_data = [c for c in data.get("data", []) if c.get("set", "").lower() == set_code]
            except Exception as e2:
                print(f"[VARIANTS] Scryfall fallback error: {e2}")
                cards_data = []

        variants = []
        for c in cards_data:
            sid = str(c.get("id")).lower()
            cnum = str(c.get("collector_number"))
            border = c.get("border_color")
            promo = c.get("promo_types") or []
            frame_effects = c.get("frame_effects") or []
            finishes = c.get("finishes") or ["nonfoil", "foil"]

            treatment = "Standard / Regular"
            if border == "borderless":
                treatment = "Borderless"
            elif "showcase" in promo or "showcase" in frame_effects:
                treatment = "Showcase"
            elif "extendedart" in promo or "extendedart" in frame_effects:
                treatment = "Extended Art"
            elif c.get("full_art"):
                treatment = "Full Art"

            if "facetfoil" in promo:
                treatment += " (Facet Foil)"

            img = ""
            if "image_uris" in c and c["image_uris"]:
                img = c["image_uris"].get("normal") or c["image_uris"].get("large", "")
            elif "card_faces" in c and len(c["card_faces"]) > 0:
                face0 = c["card_faces"][0]
                if "image_uris" in face0 and face0["image_uris"]:
                    img = face0["image_uris"].get("normal")

            for f in finishes:
                is_foil = 1 if f == "foil" else 0
                ck_item = ck_by_scryfall.get((sid, bool(is_foil)))
                
                retail = float(ck_item.get("price_retail", 0.0)) if ck_item else 0.0
                buy = float(ck_item.get("price_buy", 0.0)) if ck_item else 0.0
                qty_retail = int(ck_item.get("qty_retail", 0)) if ck_item else 0
                ck_id = ck_item.get("id") if ck_item else None
                ck_url = ("https://www.cardkingdom.com/" + ck_item.get("url", "").lstrip("/")) if ck_item else ""

                variants.append({
                    "scryfall_id": sid,
                    "collector_number": cnum,
                    "set_code": c.get("set", set_code).lower(),
                    "set_name": c.get("set_name", "Reality Fracture"),
                    "name": c.get("name"),
                    "is_foil": is_foil,
                    "treatment": treatment,
                    "finish_label": "★ Foil" if is_foil else "Non-foil",
                    "image_uri": img,
                    "price_retail": retail,
                    "price_buy": buy,
                    "qty_retail": qty_retail,
                    "ck_id": ck_id,
                    "ck_url": ck_url
                })
        CARD_VARIANTS_CACHE[cache_key] = variants

    # Mark is_current for each variant based on current card's state
    variants_output = []
    current_col = str(card_dict["collector_number"]).lower()
    current_foil = int(card_dict["is_foil"])

    for v in variants:
        v_copy = dict(v)
        v_copy["is_current"] = (str(v["collector_number"]).lower() == current_col and int(v["is_foil"]) == current_foil)
        variants_output.append(v_copy)

    return jsonify({
        "success": True,
        "card": card_dict,
        "variants": variants_output
    })

@app.route("/api/cards/<int:card_id>/variant", methods=["POST"])
def update_card_variant_route(card_id):
    data = request.json or {}
    scryfall_id = data.get("scryfall_id")
    collector_number = str(data.get("collector_number", "")).strip()
    is_foil = 1 if data.get("is_foil") else 0
    image_uri = data.get("image_uri", "").strip()
    treatment = data.get("treatment", "Standard")
    price_retail = float(data.get("price_retail", 0.0))
    price_buy = float(data.get("price_buy", 0.0))
    qty_retail = int(data.get("qty_retail", 0))
    ck_id = data.get("ck_id")
    ck_url = data.get("ck_url", "").strip()
    split_qty = int(data.get("split_qty", 0))

    if not collector_number:
        return jsonify({"error": "Collector number is required"}), 400

    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM cards WHERE id = ?", (card_id,))
    card = cursor.fetchone()
    if not card:
        conn.close()
        return jsonify({"error": "Card not found"}), 404

    card_dict = dict(card)
    current_qty = card_dict["qty"]
    set_code = card_dict["set_code"].lower()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # If split_qty specified and valid (0 < split_qty < current_qty)
    if 0 < split_qty < current_qty:
        # 1. Reduce existing row
        cursor.execute("UPDATE cards SET qty = qty - ? WHERE id = ?", (split_qty, card_id))
        
        # 2. Check if a row with the target (set_code, collector_number, is_foil) already exists
        cursor.execute("""
            SELECT id, qty FROM cards 
            WHERE set_code = ? AND collector_number = ? AND is_foil = ?
        """, (set_code, collector_number, is_foil))
        existing = cursor.fetchone()
        
        if existing:
            cursor.execute("UPDATE cards SET qty = qty + ? WHERE id = ?", (split_qty, existing["id"]))
            target_id = existing["id"]
        else:
            cursor.execute("""
                INSERT INTO cards (
                    name, set_code, collector_number, is_foil, qty,
                    scryfall_id, rarity, type_line, mana_cost, image_uri,
                    ck_id, ck_url, price_retail, price_buy, qty_retail,
                    prev_price_retail, price_change_pct, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                card_dict["name"], set_code, collector_number, is_foil, split_qty,
                scryfall_id, card_dict["rarity"], card_dict["type_line"], card_dict["mana_cost"], image_uri,
                ck_id, ck_url, price_retail, price_buy, qty_retail,
                price_retail, 0.0, now_str
            ))
            target_id = cursor.lastrowid
            
        cursor.execute("""
            INSERT INTO price_history (card_id, price_retail, price_buy, recorded_at)
            VALUES (?, ?, ?, ?)
        """, (target_id, price_retail, price_buy, now_str))
        
    else:
        # Full row update (all copies)
        cursor.execute("""
            SELECT id, qty FROM cards 
            WHERE set_code = ? AND collector_number = ? AND is_foil = ? AND id != ?
        """, (set_code, collector_number, is_foil, card_id))
        existing = cursor.fetchone()
        
        if existing:
            # Merge into existing card and delete current card
            cursor.execute("UPDATE cards SET qty = qty + ? WHERE id = ?", (current_qty, existing["id"]))
            cursor.execute("DELETE FROM cards WHERE id = ?", (card_id,))
            target_id = existing["id"]
        else:
            cursor.execute("""
                UPDATE cards SET
                    collector_number = ?,
                    is_foil = ?,
                    scryfall_id = ?,
                    image_uri = ?,
                    price_retail = ?,
                    price_buy = ?,
                    qty_retail = ?,
                    ck_id = ?,
                    ck_url = ?,
                    last_updated = ?
                WHERE id = ?
            """, (
                collector_number, is_foil, scryfall_id, image_uri,
                price_retail, price_buy, qty_retail, ck_id, ck_url,
                now_str, card_id
            ))
            target_id = card_id

        cursor.execute("""
            INSERT INTO price_history (card_id, price_retail, price_buy, recorded_at)
            VALUES (?, ?, ?, ?)
        """, (target_id, price_retail, price_buy, now_str))

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": f"เปลี่ยนเป็น {card_dict['name']} #{collector_number} ({treatment}) สำเร็จ",
        "target_id": target_id,
        "collector_number": collector_number,
        "is_foil": is_foil,
        "price_retail": price_retail,
        "price_buy": price_buy
    })

@app.route("/api/history/<int:card_id>", methods=["GET"])
def get_card_history(card_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT price_retail, price_buy, recorded_at 
        FROM price_history 
        WHERE card_id = ? 
        ORDER BY recorded_at ASC
    """, (card_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    
    cursor.execute("SELECT name, is_foil, set_code, collector_number, image_uri, ck_url, price_retail, price_buy FROM cards WHERE id = ?", (card_id,))
    card = cursor.fetchone()
    conn.close()
    
    if not card:
        return jsonify({"error": "Card not found"}), 404
        
    return jsonify({
        "card": dict(card),
        "history": rows
    })

@app.route("/api/alerts", methods=["GET"])
def get_alerts():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT a.*, c.image_uri, c.set_code, c.collector_number
        FROM alerts a
        LEFT JOIN cards c ON a.card_id = c.id
        ORDER BY a.created_at DESC
        LIMIT 50
    """)
    alerts = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify({"alerts": alerts})

@app.route("/api/alerts/mark-read", methods=["POST"])
def mark_alerts_read():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE alerts SET is_read = 1 WHERE is_read = 0")
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/alerts/simulate", methods=["POST"])
def simulate_price_alert():
    """Simulate a price jump or drop for demo/testing alerts"""
    data = request.json or {}
    card_id = data.get("card_id")
    pct_change = float(data.get("pct_change", 12.5))
    
    conn = get_connection()
    cursor = conn.cursor()
    
    if card_id:
        cursor.execute("SELECT * FROM cards WHERE id = ?", (card_id,))
    else:
        cursor.execute("SELECT * FROM cards ORDER BY price_retail DESC LIMIT 1")
    card = cursor.fetchone()
    
    if not card:
        conn.close()
        return jsonify({"error": "No card found"}), 404
        
    current_retail = float(card["price_retail"]) or 10.0
    new_retail = round(current_retail * (1.0 + pct_change / 100.0), 2)
    change_type = "INCREASE" if new_retail > current_retail else "DECREASE"
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    cursor.execute("""
        INSERT INTO alerts (card_id, card_name, is_foil, change_type, old_price, new_price, change_pct, created_at, is_read)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    """, (card["id"], card["name"], card["is_foil"], change_type, current_retail, new_retail, pct_change, now_str))
    
    cursor.execute("""
        UPDATE cards 
        SET prev_price_retail = price_retail,
            price_retail = ?,
            price_change_pct = ?,
            last_updated = ?
        WHERE id = ?
    """, (new_retail, pct_change, now_str, card["id"]))
    
    cursor.execute("""
        INSERT INTO price_history (card_id, price_retail, price_buy, recorded_at)
        VALUES (?, ?, ?, ?)
    """, (card["id"], new_retail, card["price_buy"], now_str))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        "success": True,
        "card_name": card["name"],
        "old_price": current_retail,
        "new_price": new_retail,
        "pct_change": pct_change,
        "change_type": change_type
    })

@app.route("/api/cards/<int:card_id>/sell", methods=["POST"])
def sell_card(card_id):
    data = request.json or {}
    qty_sold = max(1, int(data.get("qty_sold", 1)))
    sold_price = float(data.get("sold_price", 0.0))
    currency = data.get("currency", "USD").upper()
    buyer_note = data.get("buyer_note", "").strip()
    rate_multiplier = float(data.get("rate_multiplier", 0.0))
    
    thb_rate = float(get_setting("thb_rate", "34.0"))
    used_rate = rate_multiplier if rate_multiplier > 0 else thb_rate
    
    if currency == "THB":
        sold_price_thb = sold_price
        sold_price_usd = round(sold_price / used_rate, 2) if used_rate > 0 else sold_price
    else:
        sold_price_usd = sold_price
        sold_price_thb = round(sold_price * used_rate, 2)
        
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM cards WHERE id = ?", (card_id,))
    card = cursor.fetchone()
    
    if not card:
        conn.close()
        return jsonify({"error": "Card not found"}), 404
        
    current_qty = card["qty"]
    ck_retail = card["price_retail"] or 0.0
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    card_box_id = card["box_id"] if ("box_id" in card.keys() and card["box_id"]) else 1
    
    # Record sale
    cursor.execute("""
        INSERT INTO sales (
            card_id, card_name, set_code, collector_number, is_foil,
            image_uri, qty_sold, sold_price_usd, sold_price_thb,
            ck_retail_at_sale, buyer_note, exchange_rate, box_id, sold_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        card["id"], card["name"], card["set_code"], card["collector_number"],
        card["is_foil"], card["image_uri"], qty_sold, sold_price_usd,
        sold_price_thb, ck_retail, buyer_note, used_rate, card_box_id, now_str
    ))
    
    # Reduce inventory or remove card if sold out
    new_qty = current_qty - qty_sold
    if new_qty <= 0:
        cursor.execute("DELETE FROM cards WHERE id = ?", (card_id,))
    else:
        cursor.execute("UPDATE cards SET qty = ? WHERE id = ?", (new_qty, card_id))
        
    conn.commit()
    conn.close()
    
    return jsonify({
        "success": True,
        "card_name": card["name"],
        "qty_sold": qty_sold,
        "remaining_qty": max(0, new_qty),
        "sold_price_usd": sold_price_usd,
        "sold_price_thb": sold_price_thb,
        "exchange_rate": used_rate,
        "sold_at": now_str
    })

@app.route("/api/sales", methods=["GET"])
def get_sales():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT sales.*, boxes.name as box_name 
        FROM sales 
        LEFT JOIN boxes ON sales.box_id = boxes.id 
        ORDER BY sales.sold_at DESC
    """)
    sales = [dict(r) for r in cursor.fetchall()]
    
    total_revenue_usd = sum(s["sold_price_usd"] * s["qty_sold"] for s in sales)
    total_revenue_thb = sum(s["sold_price_thb"] * s["qty_sold"] for s in sales)
    total_cards_sold = sum(s["qty_sold"] for s in sales)
    
    conn.close()
    return jsonify({
        "sales": sales,
        "summary": {
            "total_sales_count": len(sales),
            "total_cards_sold": total_cards_sold,
            "total_revenue_usd": round(total_revenue_usd, 2),
            "total_revenue_thb": round(total_revenue_thb, 2)
        }
    })

@app.route("/api/sales/<int:sale_id>", methods=["DELETE"])
def delete_sale(sale_id):
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM sales WHERE id = ?", (sale_id,))
    sale = cursor.fetchone()
    if not sale:
        conn.close()
        return jsonify({"error": "Sale record not found"}), 404
        
    card_id = sale["card_id"]
    qty_sold = sale["qty_sold"]
    
    cursor.execute("SELECT * FROM cards WHERE id = ?", (card_id,))
    card = cursor.fetchone()
    
    if not card:
        cursor.execute("SELECT * FROM cards WHERE name = ? AND set_code = ? AND collector_number = ? AND is_foil = ?",
                       (sale["card_name"], sale["set_code"], sale["collector_number"], sale["is_foil"]))
        card = cursor.fetchone()
        
    if card:
        cursor.execute("UPDATE cards SET qty = qty + ? WHERE id = ?", (qty_sold, card["id"]))
    else:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        ck_retail = sale["ck_retail_at_sale"] or 0.0
        cursor.execute("""
            INSERT INTO cards (
                id, name, set_code, collector_number, is_foil, qty,
                image_uri, price_retail, price_buy, prev_price_retail,
                price_change_pct, last_updated
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            card_id, sale["card_name"], sale["set_code"], sale["collector_number"],
            sale["is_foil"], qty_sold, sale["image_uri"], ck_retail,
            round(ck_retail * 0.4, 2), ck_retail, 0.0, now_str
        ))
        
    cursor.execute("DELETE FROM sales WHERE id = ?", (sale_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/sets", methods=["GET"])
def get_sets():
    conn = get_connection()
    cursor = conn.cursor()
    
    thb_rate = float(get_setting("thb_rate", "34.0"))
    
    # Get all distinct set codes from cards and set_costs
    cursor.execute("""
        SELECT DISTINCT set_code FROM cards
        UNION
        SELECT DISTINCT set_code FROM set_costs
    """)
    set_codes = [r["set_code"] for r in cursor.fetchall() if r["set_code"]]
    
    sets_data = []
    default_names = {
        "fra": "Reality Fracture",
        "scd": "Starter Commander Decks",
        "ltr": "The Lord of the Rings: Tales of Middle-earth",
        "mh3": "Modern Horizons 3",
        "cmm": "Commander Masters"
    }
    
    for sc in set_codes:
        cursor.execute("SELECT * FROM cards WHERE set_code = ?", (sc,))
        cards = [dict(r) for r in cursor.fetchall()]
        
        cursor.execute("SELECT * FROM set_costs WHERE set_code = ?", (sc,))
        cost_row = cursor.fetchone()
        
        cursor.execute("SELECT COUNT(*) as count, SUM(sold_price_usd * qty_sold) as total_usd, SUM(sold_price_thb * qty_sold) as total_thb FROM sales WHERE set_code = ?", (sc,))
        sales_row = cursor.fetchone()
        
        retail_usd = sum(c["price_retail"] * c["qty"] for c in cards)
        buy_usd = sum(c["price_buy"] * c["qty"] for c in cards)
        retail_thb = round(retail_usd * thb_rate, 2)
        buy_thb = round(buy_usd * thb_rate, 2)
        
        sold_thb = round(sales_row["total_thb"] or 0.0, 2)
        sold_usd = round(sales_row["total_usd"] or 0.0, 2)
        
        set_name = cost_row["set_name"] if cost_row and cost_row["set_name"] else default_names.get(sc, sc.upper())
        box_count = cost_row["box_count"] if cost_row else 0
        cost_per_box_thb = cost_row["cost_per_box_thb"] if cost_row else 0.0
        total_cost_thb = cost_row["total_cost_thb"] if cost_row else 0.0
        notes = cost_row["notes"] if cost_row else ""
        
        net_value_thb = round(retail_thb + sold_thb, 2)
        roi_thb = round(net_value_thb - total_cost_thb, 2)
        roi_pct = round(((net_value_thb / total_cost_thb) - 1.0) * 100.0, 1) if total_cost_thb > 0 else 0.0
        is_breakeven = (net_value_thb >= total_cost_thb) and (total_cost_thb > 0)
        
        sets_data.append({
            "set_code": sc,
            "set_name": set_name,
            "unique_count": len(cards),
            "card_count": sum(c["qty"] for c in cards),
            "retail_usd": round(retail_usd, 2),
            "retail_thb": retail_thb,
            "buy_usd": round(buy_usd, 2),
            "buy_thb": buy_thb,
            "sold_usd": sold_usd,
            "sold_thb": sold_thb,
            "box_count": box_count,
            "cost_per_box_thb": cost_per_box_thb,
            "total_cost_thb": total_cost_thb,
            "notes": notes,
            "net_value_thb": net_value_thb,
            "roi_thb": roi_thb,
            "roi_pct": roi_pct,
            "is_breakeven": is_breakeven
        })
        
    conn.close()
    sets_data.sort(key=lambda x: x["retail_usd"], reverse=True)
    return jsonify({"sets": sets_data})

@app.route("/api/sets/<set_code>/cost", methods=["POST"])
def update_set_cost(set_code):
    data = request.json or {}
    box_count = max(1, int(data.get("box_count", 1)))
    cost_per_box_thb = float(data.get("cost_per_box_thb", 0.0))
    total_cost_thb = round(box_count * cost_per_box_thb, 2)
    set_name = data.get("set_name", "").strip() or set_code.upper()
    notes = data.get("notes", "").strip()
    
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO set_costs (set_code, set_name, box_count, cost_per_box_thb, total_cost_thb, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(set_code) DO UPDATE SET
            set_name = excluded.set_name,
            box_count = excluded.box_count,
            cost_per_box_thb = excluded.cost_per_box_thb,
            total_cost_thb = excluded.total_cost_thb,
            notes = excluded.notes,
            updated_at = CURRENT_TIMESTAMP
    """, (set_code.lower(), set_name, box_count, cost_per_box_thb, total_cost_thb, notes))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "total_cost_thb": total_cost_thb})

@app.route("/api/boxes", methods=["GET"])
def get_boxes():
    conn = get_connection()
    cursor = conn.cursor()
    thb_rate = float(get_setting("thb_rate", "34.0"))
    
    cursor.execute("SELECT * FROM boxes ORDER BY id ASC")
    boxes = [dict(r) for r in cursor.fetchall()]
    
    boxes_data = []
    for b in boxes:
        b_id = b["id"]
        cursor.execute("SELECT * FROM cards WHERE box_id = ?", (b_id,))
        cards = [dict(r) for r in cursor.fetchall()]
        
        cursor.execute("""
            SELECT COUNT(*) as count, 
                   SUM(sold_price_usd * qty_sold) as total_usd, 
                   SUM(sold_price_thb * qty_sold) as total_thb 
            FROM sales WHERE box_id = ?
        """, (b_id,))
        sales_row = cursor.fetchone()
        
        retail_usd = sum(c["price_retail"] * c["qty"] for c in cards)
        buy_usd = sum(c["price_buy"] * c["qty"] for c in cards)
        retail_thb = round(retail_usd * thb_rate, 2)
        buy_thb = round(buy_usd * thb_rate, 2)
        
        sold_thb = round(sales_row["total_thb"] or 0.0, 2) if sales_row else 0.0
        sold_usd = round(sales_row["total_usd"] or 0.0, 2) if sales_row else 0.0
        sold_count = sales_row["count"] or 0 if sales_row else 0
        
        box_cost = float(b["box_cost_thb"] or 0.0)
        net_value_thb = round(retail_thb + sold_thb, 2)
        roi_thb = round(net_value_thb - box_cost, 2)
        roi_pct = round(((net_value_thb / box_cost) - 1.0) * 100.0, 1) if box_cost > 0 else 0.0
        is_breakeven = (net_value_thb >= box_cost) and (box_cost > 0)
        
        boxes_data.append({
            "id": b["id"],
            "name": b["name"],
            "set_code": b["set_code"],
            "box_cost_thb": box_cost,
            "notes": b["notes"] or "",
            "created_at": b["created_at"],
            "unique_count": len(cards),
            "card_count": sum(c["qty"] for c in cards),
            "retail_usd": round(retail_usd, 2),
            "retail_thb": retail_thb,
            "buy_usd": round(buy_usd, 2),
            "buy_thb": buy_thb,
            "sold_usd": sold_usd,
            "sold_thb": sold_thb,
            "sold_count": sold_count,
            "net_value_thb": net_value_thb,
            "roi_thb": roi_thb,
            "roi_pct": roi_pct,
            "is_breakeven": is_breakeven
        })
        
    conn.close()
    return jsonify({"boxes": boxes_data})

@app.route("/api/boxes", methods=["POST"])
def create_box():
    data = request.json or {}
    name = data.get("name", "").strip()
    set_code = data.get("set_code", "").strip().lower() or "fra"
    box_cost_thb = float(data.get("box_cost_thb", 4800.0))
    notes = data.get("notes", "").strip()
    
    conn = get_connection()
    cursor = conn.cursor()
    if not name:
        cursor.execute("SELECT COUNT(*) FROM boxes")
        count = cursor.fetchone()[0] + 1
        name = f"รอบที่ {count} (Box #{count})"
        
    cursor.execute("""
        INSERT INTO boxes (name, set_code, box_cost_thb, notes)
        VALUES (?, ?, ?, ?)
    """, (name, set_code, box_cost_thb, notes))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    
    return jsonify({
        "success": True, 
        "box": {
            "id": new_id, 
            "name": name, 
            "set_code": set_code, 
            "box_cost_thb": box_cost_thb, 
            "notes": notes
        }
    })

@app.route("/api/boxes/<int:box_id>", methods=["PUT"])
def update_box(box_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    box_cost_thb = float(data.get("box_cost_thb", 4800.0))
    notes = data.get("notes", "").strip()
    set_code = data.get("set_code", "").strip().lower()
    
    conn = get_connection()
    cursor = conn.cursor()
    
    if set_code:
        cursor.execute("""
            UPDATE boxes 
            SET name = ?, box_cost_thb = ?, notes = ?, set_code = ?
            WHERE id = ?
        """, (name, box_cost_thb, notes, set_code, box_id))
    else:
        cursor.execute("""
            UPDATE boxes 
            SET name = ?, box_cost_thb = ?, notes = ?
            WHERE id = ?
        """, (name, box_cost_thb, notes, box_id))
        
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route("/api/boxes/<int:box_id>", methods=["DELETE"])
def delete_box(box_id):
    if box_id == 1:
        return jsonify({"error": "ไม่สามารถลบรอบที่ 1 ได้"}), 400
        
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE cards SET box_id = 1 WHERE box_id = ?", (box_id,))
    cursor.execute("UPDATE sales SET box_id = 1 WHERE box_id = ?", (box_id,))
    cursor.execute("DELETE FROM boxes WHERE id = ?", (box_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "reassigned_to_box_id": 1})

@app.route("/api/sync", methods=["POST"])
def manual_sync():
    data = request.json or {}
    force_download = bool(data.get("force_download", False))
    result = sync_card_prices(force_download=force_download)
    return jsonify(result)

@app.route("/api/settings", methods=["GET"])
def get_all_settings():
    return jsonify({
        "thb_rate": float(get_setting("thb_rate", "34.0")),
        "alert_threshold_pct": float(get_setting("alert_threshold_pct", "5.0")),
        "auto_sync_interval_mins": int(get_setting("auto_sync_interval_mins", "30"))
    })

@app.route("/api/export/csv", methods=["GET"])
def export_csv():
    report_type = request.args.get("type", "inventory")
    set_code = request.args.get("set_code", "").strip().lower()
    box_id = request.args.get("box_id", "").strip()
    
    conn = get_connection()
    cursor = conn.cursor()
    thb_rate = float(get_setting("thb_rate", "34.0"))
    
    output = io.StringIO()
    output.write("\ufeff") # UTF-8 BOM for Excel
    writer = csv.writer(output)
    
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
    filename = f"mtg_report_{report_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    
    if report_type == "sales":
        query = """
            SELECT sales.*, boxes.name as box_name 
            FROM sales 
            LEFT JOIN boxes ON sales.box_id = boxes.id 
            WHERE 1=1
        """
        params = []
        if box_id:
            query += " AND sales.box_id = ?"
            params.append(int(box_id))
        elif set_code:
            query += " AND sales.set_code = ?"
            params.append(set_code)
        query += " ORDER BY sales.sold_at DESC"
        cursor.execute(query, params)
        sales = [dict(r) for r in cursor.fetchall()]
        
        writer.writerow(["รายงานประวัติการขายการ์ด MTG (Card Sales Report)"])
        writer.writerow(["วันที่สร้างรายงาน", now_str])
        writer.writerow(["เรทคำนวณเงินบาท", f"x{thb_rate}"])
        if box_id and sales and sales[0].get("box_name"):
            writer.writerow(["กรองตามรอบ/บ็อก", sales[0]["box_name"]])
        elif set_code:
            writer.writerow(["กรองตามชุด", set_code.upper()])
        writer.writerow([])
        
        total_qty = sum(s["qty_sold"] for s in sales)
        total_usd = sum(s["sold_price_usd"] * s["qty_sold"] for s in sales)
        total_thb = sum(s["sold_price_thb"] * s["qty_sold"] for s in sales)
        writer.writerow(["สรุปยอดรวมการขาย"])
        writer.writerow(["จำนวนรายการขาย", len(sales)])
        writer.writerow(["จำนวนใบที่ขาย", total_qty])
        writer.writerow(["ยอดขายรวม (USD)", f"${total_usd:.2f}"])
        writer.writerow(["ยอดขายรวม (บาท)", f"{total_thb:,.2f}"])
        writer.writerow([])
        
        writer.writerow([
            "ลำดับ", "ชื่อการ์ด", "รอบเปิด (Box Round)", "ชุด (Set)", "เลขใบ", "รูปแบบ", "จำนวนที่ขาย",
            "ราคาขายต่อหน่วย (USD)", "เรทตัวคูณ (Rate)", "ราคาขายต่อหน่วย (บาท)", "ยอดรวม (บาท)",
            "CKD Retail ณ วันขาย ($)", "บันทึกผู้ซื้อ / ช่องทาง", "วันที่ขาย"
        ])
        
        for idx, s in enumerate(sales, 1):
            rate_val = s.get("exchange_rate")
            rate_str = f"x{rate_val:.1f}" if rate_val and rate_val > 0 else f"x{thb_rate:.1f}"
            writer.writerow([
                idx,
                s["card_name"],
                s.get("box_name") or f"รอบที่ {s.get('box_id', 1)}",
                (s["set_code"] or "").upper(),
                s["collector_number"] or "",
                "Foil 🌟" if s["is_foil"] else "Regular",
                s["qty_sold"],
                f"${s['sold_price_usd']:.2f}",
                rate_str,
                f"{s['sold_price_thb']:,.2f}",
                f"{s['sold_price_thb'] * s['qty_sold']:,.2f}",
                f"${(s['ck_retail_at_sale'] or 0.0):.2f}",
                s["buyer_note"] or "-",
                s["sold_at"]
            ])
            
    elif report_type == "box_roi":
        writer.writerow(["รายงานสรุปผลประกอบการและการเปิดบ็อก (Box ROI & Financial Report)"])
        writer.writerow(["วันที่สร้างรายงาน", now_str])
        writer.writerow(["เรทคำนวณเงินบาท", f"x{thb_rate}"])
        writer.writerow([])
        
        cursor.execute("SELECT * FROM boxes ORDER BY id ASC")
        boxes = [dict(r) for r in cursor.fetchall()]
        
        writer.writerow(["ตารางสรุปความคุ้มค่าของการเปิดบ็อกแต่ละรอบ (Box Opening Batches)"])
        writer.writerow([
            "ID", "ชื่อรอบ/บ็อก", "รหัสชุด", "ต้นทุนบ็อก (บาท)",
            "การ์ดที่ยังถือ (ใบ)", "มูลค่าการ์ดที่ถือ (USD)", "มูลค่าการ์ดที่ถือ (บาท)",
            "ขายแล้ว (บาท)", "มูลค่ารวมสุทธิ (บาท)", "กำไร/ขาดทุน (บาท)", "ROI (%)", "สถานะคืนทุน", "บันทึกช่วยจำ"
        ])
        
        for b in boxes:
            b_id = b["id"]
            cursor.execute("SELECT * FROM cards WHERE box_id = ?", (b_id,))
            cards = [dict(r) for r in cursor.fetchall()]
            
            cursor.execute("SELECT SUM(sold_price_thb * qty_sold) as sold_thb FROM sales WHERE box_id = ?", (b_id,))
            sold_thb = cursor.fetchone()["sold_thb"] or 0.0
            
            retail_usd = sum(c["price_retail"] * c["qty"] for c in cards)
            retail_thb = retail_usd * thb_rate
            total_cost = float(b["box_cost_thb"] or 0.0)
            net_value = retail_thb + sold_thb
            profit_thb = net_value - total_cost
            roi_pct = ((net_value / total_cost) - 1.0) * 100.0 if total_cost > 0 else 0.0
            status_text = "คืนทุนแล้ว 🎉" if profit_thb >= 0 else "ยังไม่คืนทุน"
            
            writer.writerow([
                b["id"],
                b["name"],
                (b["set_code"] or "").upper(),
                f"{total_cost:,.2f}",
                sum(c["qty"] for c in cards),
                f"${retail_usd:.2f}",
                f"{retail_thb:,.2f}",
                f"{sold_thb:,.2f}",
                f"{net_value:,.2f}",
                f"{profit_thb:+,.2f}",
                f"{roi_pct:+.1f}%",
                status_text,
                b["notes"] or ""
            ])
            
        writer.writerow([])
        writer.writerow(["หมายเหตุ: มูลค่ารวมสุทธิ = มูลค่าการ์ดที่ยังถือ (CKD Retail) + ยอดเงินที่ขายการ์ดไปแล้ว"])
        
    else:
        query = """
            SELECT cards.*, boxes.name as box_name 
            FROM cards 
            LEFT JOIN boxes ON cards.box_id = boxes.id 
            WHERE 1=1
        """
        params = []
        if box_id:
            query += " AND cards.box_id = ?"
            params.append(int(box_id))
        elif set_code:
            query += " AND cards.set_code = ?"
            params.append(set_code)
        query += " ORDER BY cards.price_retail DESC"
        cursor.execute(query, params)
        cards = [dict(r) for r in cursor.fetchall()]
        
        writer.writerow(["รายงานพอร์ตการ์ด MTG คงเหลือ (MTG Card Inventory Report)"])
        writer.writerow(["วันที่สร้างรายงาน", now_str])
        writer.writerow(["เรทคำนวณเงินบาท", f"x{thb_rate}"])
        if box_id and cards and cards[0].get("box_name"):
            writer.writerow(["กรองตามรอบ/บ็อก", cards[0]["box_name"]])
        elif set_code:
            writer.writerow(["กรองเฉพาะชุด", set_code.upper()])
        writer.writerow([])
        
        total_unique = len(cards)
        total_qty = sum(c["qty"] for c in cards)
        total_retail_usd = sum(c["price_retail"] * c["qty"] for c in cards)
        total_retail_thb = total_retail_usd * thb_rate
        total_buy_usd = sum(c["price_buy"] * c["qty"] for c in cards)
        total_buy_thb = total_buy_usd * thb_rate
        
        writer.writerow(["สรุปภาพรวมพอร์ต"])
        writer.writerow(["จำนวนชนิดการ์ด", total_unique])
        writer.writerow(["จำนวนการ์ดทั้งหมด", total_qty])
        writer.writerow(["มูลค่ารวม CKD Retail ($)", f"${total_retail_usd:.2f}"])
        writer.writerow(["มูลค่ารวมเทียบเงินบาท (THB)", f"{total_retail_thb:,.2f} บาท"])
        writer.writerow(["มูลค่ารับซื้อคืน CKD Buylist ($)", f"${total_buy_usd:.2f}"])
        writer.writerow(["มูลค่ารับซื้อคืนเทียบเงินบาท (THB)", f"{total_buy_thb:,.2f} บาท"])
        writer.writerow([])
        
        writer.writerow([
            "ลำดับ", "ชื่อการ์ด", "รอบเปิด (Box Round)", "ชุด (Set)", "เลขใบ", "ความหายาก (Rarity)", "รูปแบบ (Finish)",
            "จำนวน (Qty)", "CKD Retail ต่อหน่วย ($)", "ราคาต่อหน่วย (บาท)", "มูลค่ารวม (บาท)",
            "CKD Buylist ($)", "การเปลี่ยนแปลงราคา (%)", "Stock ร้าน CKD", "ลิงก์ Card Kingdom"
        ])
        
        for idx, c in enumerate(cards, 1):
            retail_thb = c["price_retail"] * thb_rate
            total_thb = retail_thb * c["qty"]
            writer.writerow([
                idx,
                c["name"],
                c.get("box_name") or f"รอบที่ {c.get('box_id', 1)}",
                c["set_code"].upper(),
                c["collector_number"],
                c["rarity"].capitalize() if c["rarity"] else "",
                "Foil 🌟" if c["is_foil"] else "Regular",
                c["qty"],
                f"${c['price_retail']:.2f}",
                f"{retail_thb:,.2f}",
                f"{total_thb:,.2f}",
                f"${c['price_buy']:.2f}",
                f"{c['price_change_pct']:+.1f}%",
                c["qty_retail"],
                c["ck_url"] or ""
            ])
            
    conn.close()
    
    csv_bytes = output.getvalue().encode("utf-8")
    return Response(
        csv_bytes,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.route("/api/export/summary-text", methods=["GET"])
def export_summary_text():
    set_code = request.args.get("set_code", "").strip().lower()
    box_id = request.args.get("box_id", "").strip()
    conn = get_connection()
    cursor = conn.cursor()
    thb_rate = float(get_setting("thb_rate", "34.0"))
    
    if box_id:
        b_id = int(box_id)
        cursor.execute("SELECT * FROM cards WHERE box_id = ? ORDER BY price_retail DESC", (b_id,))
        cards = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM boxes WHERE id = ?", (b_id,))
        box_row = cursor.fetchone()
        cursor.execute("SELECT SUM(sold_price_thb * qty_sold) as sold_thb FROM sales WHERE box_id = ?", (b_id,))
        sold_thb = cursor.fetchone()["sold_thb"] or 0.0
        set_title = f"{box_row['name'] if box_row else f'Box #{b_id}'}"
        box_cost_thb = float(box_row["box_cost_thb"] or 0.0) if box_row else 0.0
    elif set_code:
        cursor.execute("SELECT * FROM cards WHERE set_code = ? ORDER BY price_retail DESC", (set_code,))
        cards = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT * FROM set_costs WHERE set_code = ?", (set_code,))
        cost_row = cursor.fetchone()
        cursor.execute("SELECT SUM(sold_price_thb * qty_sold) as sold_thb FROM sales WHERE set_code = ?", (set_code,))
        sold_thb = cursor.fetchone()["sold_thb"] or 0.0
        set_title = f"{cost_row['set_name'] if cost_row else set_code.upper()} ({set_code.upper()})"
        box_cost_thb = (cost_row["total_cost_thb"] if cost_row and "total_cost_thb" in cost_row.keys() else 0.0) or 0.0
    else:
        cursor.execute("SELECT * FROM cards ORDER BY price_retail DESC")
        cards = [dict(r) for r in cursor.fetchall()]
        cursor.execute("SELECT SUM(box_cost_thb) as total_cost FROM boxes")
        cost_row = cursor.fetchone()
        cursor.execute("SELECT SUM(sold_price_thb * qty_sold) as sold_thb FROM sales")
        sold_thb = cursor.fetchone()["sold_thb"] or 0.0
        set_title = "พอร์ตการ์ด MTG ทั้งหมด (All Boxes)"
        box_cost_thb = float(cost_row["total_cost"] or 0.0) if cost_row else 0.0
        
    total_retail_usd = sum(c["price_retail"] * c["qty"] for c in cards)
    total_retail_thb = total_retail_usd * thb_rate
    net_thb = total_retail_thb + sold_thb
    roi_thb = net_thb - box_cost_thb
    roi_pct = ((net_thb / box_cost_thb) - 1.0) * 100.0 if box_cost_thb > 0 else 0.0
    
    lines = [
        f"📋 สรุปรายงานมูลค่าการ์ด MTG — {set_title}",
        f"📅 อัปเดตล่าสุด: {datetime.now().strftime('%Y-%m-%d %H:%M')} (อิง Card Kingdom x{thb_rate})",
        "----------------------------------------",
        f"💎 มูลค่าการ์ดในมือ (Unsold): ${total_retail_usd:,.2f} (~฿{total_retail_thb:,.0f})",
        f"💰 ขายคืนแล้ว (Realized Sales): ฿{sold_thb:,.0f}",
    ]
    if box_cost_thb > 0:
        lines.append(f"📦 ต้นทุนบ็อก: ฿{box_cost_thb:,.0f}")
        status = f"🎉 คืนทุนแล้ว (+฿{roi_thb:,.0f} / {roi_pct:+.1f}%)" if roi_thb >= 0 else f"📉 ขาดอีก ฿{abs(roi_thb):,.0f} จะคืนทุน ({roi_pct:+.1f}%)"
        lines.append(f"🎯 สถานะ ROI: {status}")
        
    lines.append("----------------------------------------")
    lines.append("🏆 Top การ์ดมูลค่าสูงสุด:")
    for idx, c in enumerate(cards[:10], 1):
        foil = " ★Foil" if c["is_foil"] else ""
        lines.append(f"{idx}. {c['name']}{foil} — ${c['price_retail']:.2f} (~฿{Math_round(c['price_retail']*thb_rate):,})")
        
    conn.close()
    return jsonify({"text": "\n".join(lines)})

def Math_round(val):
    return int(round(val))

@app.route("/api/settings", methods=["POST"])
def update_settings():
    data = request.json or {}
    if "thb_rate" in data:
        set_setting("thb_rate", str(float(data["thb_rate"])))
    if "alert_threshold_pct" in data:
        set_setting("alert_threshold_pct", str(float(data["alert_threshold_pct"])))
    if "auto_sync_interval_mins" in data:
        set_setting("auto_sync_interval_mins", str(int(data["auto_sync_interval_mins"])))
    return jsonify({"success": True})

# Initialize database tables and start background sync worker
init_db()
if not os.environ.get("NO_BACKGROUND_SYNC"):
    t = threading.Thread(target=background_sync_worker, daemon=True)
    t.start()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5055))
    print(f"🚀 MTG Card Kingdom Tracker running on http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)

