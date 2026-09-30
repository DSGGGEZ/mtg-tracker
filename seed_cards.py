import json
import urllib.request
import re
from db import get_connection, init_db

INITIAL_CARDS_TEXT = """
1 Avatar of Burgeoning Echoes (FRA) 122
1 Bloodline Recollector / Ancestral Craving (FRA) 49
1 Carnivorous Cultivator / Enroot (FRA) 100
1 Curse-Marred Demon (FRA) 79
1 Dark Matter Manipulator (FRA) 52
1 Darklight Phoenix (FRA) 53
1 Diviner of Victory / Unwind History (FRA) 28
1 Draconic Visitor (FRA) 80
1 Extrapolate the Impossible (FRA) 55
1 Garruk, Curse Breaker (FRA) 259
1 Garruk, Veiled Butcher (FRA) 229
1 Geist of Saint Thalia (FRA) 299
1 Germinate Recruits (FRA) 9
1 Gideon the Oathless (FRA) 230
1 Haunted Ridge (FRA) 180
1 Karn, Argent Defender (FRA) 279
1 Karn, Gilded Guardian (FRA) 272
1 Kindred Judgment (FRA) 13
1 Lich's Relic (FRA) 57
1 Liliana the Faultless (FRA) 200
1 Liliana the Repentant (FRA) 231
1 Master of Barbs (FRA) 88
1 Mountain (SCD) 348
1 Omnipresence (FRA) 110
1 Overgrown Farmland (FRA) 185
1 Overwrite the Multiverse (FRA) 59
1 Proctor of Potential (FRA) 145
1 Puppet Crafting (FRA) 111
1 Pyre Rhymer / Molten Tide (FRA) 91
1 Rockfall Vale (FRA) 186
1 Rockfall Vale (FRA) 400
1 Sanctum Lurker (FRA) 64
1 Seasoned Cryomancer (FRA) 38
1 Simulacrum Shaper (FRA) 113
1 Stinging Vitriol (FRA) 152
1 Tenured Tethermage (FRA) 357
1 Thalia, the Survivor (FRA) 296
1 Theorist's Proxy (FRA) 44
1 Theorist's Sanctum (FRA) 191
1 Uldaros Theorix (FRA) 159 *F*
1 Vindictive Triumph (FRA) 162
1 Vraska, Soul of Stone (FRA) 277
1 Vraska, the Cutting Glare (FRA) 278
1 Winter, Tormented Loner (FRA) 307
"""

def parse_moxfield_text(text):
    lines = [l.strip() for l in text.strip().split("\n") if l.strip()]
    parsed = []
    for line in lines:
        # Format 1: 1 Card Name (SET) 123 [*F*]
        m = re.match(r"^(\d+)\s+(.+?)\s+\(([A-Za-z0-9]+)\)\s+([A-Za-z0-9★]+)(\s+\*F\*)?", line)
        if m:
            qty, name, set_code, col_num, foil = m.groups()
            parsed.append({
                "qty": int(qty),
                "name": name.strip(),
                "set_code": set_code.lower().strip(),
                "collector_number": col_num.strip(),
                "is_foil": 1 if foil else 0
            })
            continue

        # Format 2: 1 Card Name (SET) [*F*]
        m2 = re.match(r"^(\d+)\s+(.+?)\s+\(([A-Za-z0-9]+)\)(\s+\*F\*)?", line)
        if m2:
            qty, name, set_code, foil = m2.groups()
            parsed.append({
                "qty": int(qty),
                "name": name.strip(),
                "set_code": set_code.lower().strip(),
                "collector_number": "",
                "is_foil": 1 if foil else 0
            })
            continue

        # Format 3: 1 Card Name [*F*]
        m3 = re.match(r"^(\d+)\s+(.+?)(\s+\*F\*)?$", line)
        if m3:
            qty, name, foil = m3.groups()
            parsed.append({
                "qty": int(qty),
                "name": name.strip(),
                "set_code": "",
                "collector_number": "",
                "is_foil": 1 if foil else 0
            })
            continue

    return parsed

def fetch_scryfall_metadata(cards_spec):
    if not cards_spec:
        return {}
        
    identifiers = []
    for c in cards_spec:
        if c.get("set_code") and c.get("collector_number"):
            identifiers.append({"set": c["set_code"], "collector_number": c["collector_number"]})
        elif c.get("set_code"):
            identifiers.append({"name": c["name"], "set": c["set_code"]})
        else:
            identifiers.append({"name": c["name"]})
    
    # Scryfall collection supports up to 75 identifiers at a time
    results = []
    chunk_size = 75
    headers = {
        "User-Agent": "MTGPriceTracker/1.0",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    
    for i in range(0, len(identifiers), chunk_size):
        chunk = identifiers[i:i+chunk_size]
        req_data = json.dumps({"identifiers": chunk}).encode("utf-8")
        req = urllib.request.Request("https://api.scryfall.com/cards/collection", data=req_data, headers=headers)
        try:
            with urllib.request.urlopen(req) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                results.extend(data.get("data", []))
        except Exception as e:
            print(f"[SCRYFALL_ERR] {e}")
            
    # Index by (set_code, collector_number) and name
    scryfall_map = {}
    for card in results:
        set_code = card.get("set", "").lower()
        col_num = str(card.get("collector_number", "")).lower()
        name_lower = card.get("name", "").lower()
        
        scryfall_map[(set_code, col_num)] = card
        if (set_code, "") not in scryfall_map:
            scryfall_map[(set_code, "")] = card
        if name_lower not in scryfall_map:
            scryfall_map[name_lower] = card
        
    return scryfall_map

def seed_cards(text=INITIAL_CARDS_TEXT):
    init_db()
    parsed_cards = parse_moxfield_text(text)
    print(f"Parsed {len(parsed_cards)} cards from text.")
    
    scryfall_map = fetch_scryfall_metadata(parsed_cards)
    print(f"Fetched metadata for {len(scryfall_map)} cards from Scryfall.")
    
    conn = get_connection()
    cursor = conn.cursor()
    
    inserted_count = 0
    for c in parsed_cards:
        key = (c["set_code"], c["collector_number"].lower())
        scry_data = scryfall_map.get(key)
        
        name = c["name"]
        scryfall_id = None
        rarity = "common"
        type_line = ""
        mana_cost = ""
        image_uri = ""
        
        if scry_data:
            name = scry_data.get("name", name)
            scryfall_id = scry_data.get("id")
            rarity = scry_data.get("rarity", "common")
            type_line = scry_data.get("type_line", "")
            mana_cost = scry_data.get("mana_cost", "")
            
            # Extract image URI
            if "image_uris" in scry_data:
                image_uri = scry_data["image_uris"].get("normal") or scry_data["image_uris"].get("large")
            elif "card_faces" in scry_data and len(scry_data["card_faces"]) > 0:
                first_face = scry_data["card_faces"][0]
                if "image_uris" in first_face:
                    image_uri = first_face["image_uris"].get("normal")
                    
        # Check if already exists in DB
        cursor.execute("""
            SELECT id FROM cards 
            WHERE set_code = ? AND collector_number = ? AND is_foil = ?
        """, (c["set_code"], c["collector_number"], c["is_foil"]))
        row = cursor.fetchone()
        
        if not row:
            cursor.execute("""
                INSERT INTO cards (
                    name, set_code, collector_number, is_foil, qty,
                    scryfall_id, rarity, type_line, mana_cost, image_uri
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                name, c["set_code"], c["collector_number"], c["is_foil"], c["qty"],
                scryfall_id, rarity, type_line, mana_cost, image_uri
            ))
            inserted_count += 1
            
    conn.commit()
    conn.close()
    print(f"Successfully seeded {inserted_count} new cards into database.")

if __name__ == "__main__":
    seed_cards()
