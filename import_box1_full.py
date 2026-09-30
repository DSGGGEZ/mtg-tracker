import sys
import os
import sqlite3
from datetime import datetime

from seed_cards import parse_moxfield_text, fetch_scryfall_metadata
from ck_sync import get_ck_pricelist
from db import get_connection

RAW_CARDS_TEXT = """3 Academic Ascent (FRA) 2
3 Afterthought Sentry (FRA) 166
3 Apex Witchstalker (FRA) 48
3 Arcane Amphisbaena (FRA) 97
1 Archive Arbiter (FRA) 167
1 Arni, Humble Scribe (FRA) 211
3 Artifist Acumen (FRA) 73
1 Avatar of Burgeoning Echoes (FRA) 122
3 Awaken the Inferno (FRA) 74
3 Bestial Incursion (FRA) 98
3 Blazing Crescendo (MSH) 340
2 Blessed Ghoul (FRA) 123
1 Bloodline Recollector / Ancestral Craving (FRA) 49
1 Bloombrute (FRA) 124
2 Blossom-Blessed Angel / Seed Suture (FRA) 3
1 Break Under Pressure (FRA) 50
3 Budding Insurgent (FRA) 99
2 Campus Crier (FRA) 4
1 Carnivorous Cultivator / Enroot (FRA) 100
2 Cast Away Doubt (FRA) 51
2 Chandra's Emberling (FRA) 76
2 Charge the Sanctum (FRA) 125
1 Clash of Elements (FRA) 126
2 Command the Stage (FRA) 77
2 Compel Brutality (FRA) 101
2 Countersculpt (FRA) 25
1 Craftwork Crusher (FRA) 127
3 Cryotheory Adept (FRA) 27
1 Curse-Marred Demon (FRA) 79
1 Danitha, Spear of Agony (FRA) 227
1 Dark Matter Manipulator (FRA) 52
1 Darklight Phoenix (FRA) 53
1 Diviner of Victory / Unwind History (FRA) 28
3 Divining Duelist (FRA) 29
1 Draconic Visitor (FRA) 80
2 Eardrum Rattler (FRA) 81
1 Edgar, Ancient Bloodlord (FRA) 270
1 Edgar, Moonlit Sovereign (FRA) 257
2 Emergency Phytomedic / Seed Suture (FRA) 130
3 Extended Absence (FRA) 54
2 Extrapolate the Impossible (FRA) 55
1 Eye of Jace (FRA) 170
1 Fatehold Annex (FRA) 177
1 Fatehold Charm (FRA) 132
3 Fatehold Chronologist / Peer Review (FRA) 133
3 Fateshaper Aspirant (FRA) 6
1 Fblthp, Impossibly Lost (FRA) 213
1 Fblthp, Knows the Way (FRA) 258
2 Ferocity of the Hunt (FRA) 134
1 Flourishing Grapple (FRA) 102
1 Forest (FRA) 395
2 Fulminous Forte (FRA) 84
1 Gallia, the Merrymaker (FRA) 245
1 Gallia, Tragic Host (FRA) 228
1 Garruk, Curse Breaker (FRA) 259
1 Garruk, Veiled Butcher (FRA) 229
1 Geist of Saint Thalia (FRA) 299
1 Generous Revival (FRA) 8
1 Germinate Recruits (FRA) 9
1 Ghalta the Immovable (FRA) 197
1 Ghalta the Unstoppable (FRA) 260
2 Gideon the Oathless (FRA) 230
1 Gideon's Memorial (FRA) 198
3 Graft Surgeon (FRA) 10
2 Greenhouse Propagator (FRA) 104
1 Grim Repriser (FRA) 136
2 Hallway Heckler / Vicious Verse (FRA) 85
1 Hapatra, the Desert Fang (FRA) 271
1 Hapatra, the Desert Frost (FRA) 215
1 Haunted Ridge (FRA) 180
3 Heartstring Puller (FRA) 86
1 Heartwood Crafter / Soul Tether (FRA) 105
2 Hexhaven Battalion (FRA) 12
1 Hexhaven Dueling Arena (FRA) 181
1 Hunter's Axe (FRA) 108
2 Icy Reception (FRA) 30
2 Infinite Coursework (FRA) 31
1 Innovative Commons (FRA) 182
3 Inspired Tethermage (FRA) 109
1 Island (FRA) 387
1 Island (FRA) 385
2 Jiang Yanggu, Alone (FRA) 246
2 Jiang Yanggu, Never Alone (FRA) 261
1 Karn, Argent Defender (FRA) 279
1 Karn, Gilded Guardian (FRA) 272
3 Keeper of the Quiet Hour (FRA) 171
1 Kindred Judgment (FRA) 13
1 Kiora of Fire and Ashes (FRA) 247
1 Kiora of Salt and Sand (FRA) 273
1 Konstrari Annex (FRA) 183
1 Konstrari Charm (FRA) 138
3 Konstrari Improviser / Soul Tether (FRA) 139
1 Koth of the Homestead (FRA) 199
1 Koth, the Geomancer (FRA) 248
3 Last Gasp (FRA) 56
1 Lich's Relic (FRA) 57
1 Liliana the Faultless (FRA) 200
1 Liliana the Repentant (FRA) 231
4 Living Library (FRA) 172
1 Loot, the Anomaly (FRA) 232
1 Loot, the Nexus (FRA) 262
1 Mabel, Bitter Recluse (FRA) 233
2 Mabel, Valley Hero (FRA) 274
1 Marwyn, the Clearcutter (FRA) 249
1 Marwyn, the Preserver (FRA) 263
1 Massacre Girl, Most Wanted (FRA) 234
1 Master of Barbs (FRA) 88
3 Medic's Kitesail (FRA) 173
3 Memory Trap (FRA) 15
1 Meticulous Commons (FRA) 184
2 Mind Meanderer (FRA) 141
3 Mindseeker Oculus (FRA) 33
1 Mountain (FRA) 393
1 Mountain (FRA) 391
1 Multiply by Zero (FRA) 58
3 Murmuring Volume (FRA) 174
3 No Admittance (FRA) 89
1 Omnipresence (FRA) 110
1 Overgrown Farmland (FRA) 185
1 Overwrite the Multiverse (FRA) 59
2 Paradox Shaper / Omit Variables (FRA) 143
1 Perfected Theory (FRA) 34
1 Pia, Aether Ascetic (FRA) 264
2 Pia, Determined Rebuilder (FRA) 250
1 Plains (FRA) 383
1 Plan for All Outcomes (FRA) 35
3 Predictive Preparations (FRA) 16
1 Primal Witchstalker (FRA) 144
1 Proctor of Potential (FRA) 145
2 Proft, Consulting Detective (FRA) 218
2 Proft, Sinister Mastermind (FRA) 235
1 Prophesied End (FRA) 17
2 Protege's Awakening (FRA) 37
1 Prudent Fateseer / Peer Review (FRA) 146 *F*
1 Prudent Fateseer / Peer Review (FRA) 146
1 Puppet Crafting (FRA) 111
1 Pyre Rhymer / Molten Tide (FRA) 91
2 Rampart Hunter (FRA) 60
3 Rank Rat (FRA) 61
1 Recursive Recruitment (FRA) 147
3 Refute Destiny (FRA) 18
1 Rescue Girl, First Responder (FRA) 202
1 Restore with Empathy (FRA) 112
1 Rewrite Regrets (FRA) 62
1 Rockfall Vale (FRA) 186
1 Rockfall Vale (FRA) 400
1 Ruric Thar, Biomagus (FRA) 219
2 Ruric Thar, Magecrusher (FRA) 265
1 Saheeli, Consul of Oversight (FRA) 203
1 Saheeli, Jewel of Avishkar (FRA) 275
1 Sanctum Lurker (FRA) 64
2 Screeching Soulbreaker (FRA) 65
1 Seasoned Cryomancer (FRA) 324
2 Semester Foreseer / Peer Review (FRA) 39
3 Shatterwing Pegasus (FRA) 21
3 Silence the Echo (FRA) 66
1 Simulacrum Shaper (FRA) 113
3 Skilled Battlecarver (FRA) 92
3 Solve for Disappointment (FRA) 67
3 Something Worth Saving (FRA) 114
2 Sphinx's Approach (FRA) 41
1 Stingerquill Annex (FRA) 190
1 Stingerquill Charm (FRA) 150
1 Stingerquill Voxmancer / Vicious Verse (FRA) 151
1 Stinging Vitriol (FRA) 152
2 Sureshot Sower (FRA) 115
3 Surgical Precision (FRA) 22
2 Surveillance Phantasm (FRA) 42
1 Swamp (FRA) 390
3 Tam's Resistance (FRA) 153
1 Tenured Tethermage (FRA) 357
1 Terminal Criticism (FRA) 68
2 Tether Technician (FRA) 94
3 Tethermage's Advantage (FRA) 117
1 Tetsuko Umezawa, Fugitive (FRA) 221
1 Tetsuko Umezawa, Pursuer (FRA) 252
1 Teyo, Diamondblade Mage (FRA) 236
1 Teyo, Lightshield Expert (FRA) 204
1 Thalia, the Survivor (FRA) 296
2 Theoretical Necromancer (FRA) 69
1 Theorist's Proxy (FRA) 44
1 Theorist's Sanctum (FRA) 191
1 Theorix Annex (FRA) 192
2 Theorix Charm (FRA) 155
2 Theorix Metamage / Omit Variables (FRA) 156
2 Tinybones, Pocket Nuisance (FRA) 237
3 Titanbones, Towering Heart (FRA) 266
2 Tomik, Izzet Sparkmage (FRA) 253
1 Transformative Commons (FRA) 193
1 Traxos, Academy Guardian (FRA) 222
1 Traxos, Scourge Eternal (FRA) 280
1 Twinned Vision (FRA) 157
1 Twisted Fates (FRA) 158
1 Uldaros Theorix (FRA) 159 *F*
3 Undulating Witness (FRA) 45
2 Unflinching Hortimancer (FRA) 23
2 Unsummon (FRA) 46
1 Vigorbloom Annex (FRA) 194
2 Vigorbloom Charm (FRA) 160
1 Vigorbloom Vanguard / Seed Suture (FRA) 161
1 Vindictive Triumph (FRA) 162
3 Vinelasher Adept (FRA) 119
1 Violent Echoes (FRA) 95
3 Void Extrapolator / Omit Variables (FRA) 70
1 Vraska, Soul of Stone (FRA) 277
1 Vraska, the Cutting Glare (FRA) 278
1 Warrior's Blades (FRA) 163
1 Way of the Cryomancer (FRA) 223
1 Way of the Deathbringer (FRA) 238
3 Way of the Healer (FRA) 207
2 Way of the Mentor (FRA) 208
1 Way of the Necromancer (FRA) 239
1 Way of the Pyromancer (FRA) 254
2 Way of the Warlord (FRA) 255
1 Way of the Wildspeaker (FRA) 268
1 Whiplash Wordsmith / Vicious Verse (FRA) 164
1 Winter, Tormented Loner (FRA) 307
2 Woodwork Prodigy / Soul Tether (FRA) 165
2 Wrath of the Bloodmane (FRA) 96
3 Wrecking Gecko (FRA) 120
1 Yargle, Glutton of Urborg (FRA) 241
1 Yargle, Goliath of Otaria (FRA) 225
1 Yoshimaru, Beloved Companion (FRA) 209
1 Yoshimaru, Scrappy Stray (FRA) 269
2 Your Fate Ends Here (FRA) 24
1 Yuriko, Blade of the Mighty (FRA) 210
2 Yuriko, Hope from the Shadows (FRA) 226"""

def main():
    print("=== MTG Tracker: Updating Box #1 with Complete 365-Card List ===")
    parsed = parse_moxfield_text(RAW_CARDS_TEXT)
    print(f"Parsed {len(parsed)} card entries (Total quantity: {sum(c['qty'] for c in parsed)})")

    print("\n1. Fetching Scryfall metadata...")
    scryfall_map = fetch_scryfall_metadata(parsed)
    print(f"Scryfall metadata fetched for {len(scryfall_map)} keys.")

    print("\n2. Loading Card Kingdom pricelist...")
    ck_items = get_ck_pricelist(force_download=False)
    print(f"Loaded {len(ck_items)} CK pricelist items.")

    # Index CK items by (scryfall_id, is_foil) and by (name_lower, is_foil)
    ck_by_scryfall = {}
    ck_by_name = {}
    for it in ck_items:
        sid = str(it.get("scryfall_id", "")).lower()
        is_f = (str(it.get("is_foil")).lower() == "true")
        name_clean = str(it.get("name", "")).strip().lower()
        if sid:
            ck_by_scryfall[(sid, is_f)] = it
        if name_clean:
            ck_by_name.setdefault((name_clean, is_f), []).append(it)

    conn = get_connection()
    cursor = conn.cursor()

    # Verify existing sales
    cursor.execute("SELECT COUNT(*), SUM(sold_price_thb * qty_sold) FROM sales WHERE box_id = 1")
    sales_info = cursor.fetchone()
    print(f"\nExisting sales for Box #1: {sales_info[0]} sales totaling ฿{sales_info[1]:,.2f} THB (Preserved!)")

    # Clear existing cards for Box 1
    cursor.execute("DELETE FROM cards WHERE box_id = 1")
    print("Cleared previous cards in Box #1.")

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    inserted_count = 0
    total_qty_inserted = 0

    for c in parsed:
        scry_data = None
        if c["set_code"] and c["collector_number"]:
            scry_data = scryfall_map.get((c["set_code"], str(c["collector_number"]).lower()))
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

        is_foil = c["is_foil"]
        is_foil_bool = bool(is_foil)

        # Match CK Item
        ck_item = None
        if scryfall_id:
            ck_item = ck_by_scryfall.get((scryfall_id.lower(), is_foil_bool))
        if not ck_item:
            clean_name = name.split("//")[0].strip().lower()
            matches = ck_by_name.get((clean_name, is_foil_bool), [])
            if matches:
                # Prefer same set if possible
                same_set = [m for m in matches if str(m.get("variation", "")).lower() == set_code or set_code in str(m.get("url", "")).lower()]
                ck_item = same_set[0] if same_set else matches[0]

        price_retail = float(ck_item.get("price_retail", 0.0)) if ck_item else 0.0
        price_buy = float(ck_item.get("price_buy", 0.0)) if ck_item else 0.0
        qty_retail = int(ck_item.get("qty_retail", 0)) if ck_item else 0
        ck_id = ck_item.get("id") if ck_item else None
        ck_url = f"https://www.cardkingdom.com{ck_item['url']}" if ck_item and ck_item.get("url") else None

        cursor.execute("""
            INSERT INTO cards (
                name, set_code, collector_number, is_foil, qty,
                scryfall_id, rarity, type_line, mana_cost, image_uri,
                ck_id, ck_url, price_retail, price_buy, qty_retail,
                prev_price_retail, price_change_pct, last_updated, box_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        """, (
            name, set_code, col_num, is_foil, c["qty"],
            scryfall_id, rarity, type_line, mana_cost, image_uri,
            ck_id, ck_url, price_retail, price_buy, qty_retail,
            price_retail, 0.0, now_str
        ))
        card_id = cursor.lastrowid

        # Insert initial price history point
        cursor.execute("""
            INSERT INTO price_history (card_id, price_retail, price_buy, recorded_at)
            VALUES (?, ?, ?, ?)
        """, (card_id, price_retail, price_buy, now_str))

        inserted_count += 1
        total_qty_inserted += c["qty"]

    conn.commit()

    # Generate summary
    cursor.execute("SELECT COUNT(*), SUM(qty), SUM(price_retail * qty), SUM(price_buy * qty) FROM cards WHERE box_id = 1")
    row = cursor.fetchone()
    total_unique = row[0]
    total_qty = row[1]
    total_retail_usd = row[2] or 0.0
    total_buy_usd = row[3] or 0.0

    cursor.execute("SELECT SUM(sold_price_thb * qty_sold) FROM sales WHERE box_id = 1")
    sold_thb = cursor.fetchone()[0] or 0.0

    thb_rate = 34.0
    retail_thb = total_retail_usd * thb_rate
    net_thb = retail_thb + sold_thb
    box_cost = 4800.0
    roi_thb = net_thb - box_cost
    roi_pct = ((net_thb / box_cost) - 1.0) * 100.0

    print("\n=== Box #1 Updated Successfully! ===")
    print(f"Total Unique Cards: {total_unique}")
    print(f"Total Card Quantity: {total_qty} cards")
    print(f"Total Retail USD: ${total_retail_usd:,.2f} (~฿{retail_thb:,.2f} THB)")
    print(f"Total Buylist USD: ${total_buy_usd:,.2f}")
    print(f"Realized Sales Preserved: ฿{sold_thb:,.2f} THB")
    print(f"Net Portfolio Value: ฿{net_thb:,.2f} THB")
    print(f"Box Cost: ฿{box_cost:,.2f} THB")
    print(f"Net ROI: {roi_thb:+,.2f} THB ({roi_pct:+.1f}%)")
    print(f"Break-even Status: {'🎉 คืนทุนแล้ว' if roi_thb >= 0 else 'ยังไม่คืนทุน'}")

    conn.close()

if __name__ == "__main__":
    main()
