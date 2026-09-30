// Immediate Display Scale Application to prevent FOUC
(function() {
    let savedScale = localStorage.getItem('mtg_ui_scale');
    if (!savedScale) {
        const isMac = (navigator.platform && navigator.platform.toUpperCase().includes('MAC')) ||
                      (navigator.userAgent && navigator.userAgent.includes('Macintosh'));
        if (window.innerWidth <= 1536 || (isMac && window.innerWidth <= 1680)) {
            savedScale = 'macbook';
        } else {
            savedScale = 'normal';
        }
    }
    document.documentElement.setAttribute('data-scale', savedScale);
})();

let allCards = [];
let currentSummary = null;
let currentView = 'grid';
let filterAlertsOnly = false;
let selectedSet = '';
let setsList = [];
let selectedBoxId = null;
let boxesList = [];
let priceChart = null;
let thbRate = 34.0;
let audioCtx = null;

// Display Scale Controller (MacBook Air M3 Optimization)
function initDisplayScale() {
    let savedScale = localStorage.getItem('mtg_ui_scale');
    if (!savedScale) {
        const isMac = (navigator.platform && navigator.platform.toUpperCase().includes('MAC')) ||
                      (navigator.userAgent && navigator.userAgent.includes('Macintosh'));
        if (window.innerWidth <= 1536 || (isMac && window.innerWidth <= 1680)) {
            savedScale = 'macbook';
        } else {
            savedScale = 'normal';
        }
    }
    applyDisplayScale(savedScale, false);
}

function applyDisplayScale(scale, save = true) {
    if (!['compact', 'macbook', 'normal'].includes(scale)) {
        scale = 'macbook';
    }
    document.documentElement.setAttribute('data-scale', scale);
    
    if (save) {
        localStorage.setItem('mtg_ui_scale', scale);
    }
    
    // Update active scale buttons
    document.querySelectorAll('.scale-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-scale-val') === scale);
    });
    
    // Update select in settings modal if exists
    const selectScale = document.getElementById('selectDisplayScale');
    if (selectScale) {
        selectScale.value = scale;
    }
}

// Sound synthesizer using Web Audio API
function playAlertSound(isGain = true) {
    const soundEnabled = document.getElementById('checkSoundAlert')?.checked;
    if (!soundEnabled) return;

    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        if (isGain) {
            osc.frequency.setValueAtTime(587.33, now); // D5
            osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.15); // A5
        } else {
            osc.frequency.setValueAtTime(659.25, now); // E5
            osc.frequency.exponentialRampToValueAtTime(440.00, now + 0.2); // A4
        }
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        
        osc.start(now);
        osc.stop(now + 0.35);
    } catch (e) {
        console.warn('Audio not allowed yet or not supported', e);
    }
}

// Toast Notifications
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Modal Helpers
function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Fetch Settings
async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        thbRate = data.thb_rate || 34.0;
        document.getElementById('headerThbRate').textContent = `x${thbRate.toFixed(1)}`;
        document.getElementById('inputThbRate').value = thbRate;
        document.getElementById('inputAlertThreshold').value = data.alert_threshold_pct || 5.0;
        document.getElementById('inputSyncInterval').value = data.auto_sync_interval_mins || 30;
        initDisplayScale();
    } catch (e) {
        console.error('Failed to load settings', e);
    }
}

// Load Cards and Summaries
async function loadCards() {
    const search = document.getElementById('searchInput').value.trim();
    const rarity = document.getElementById('filterRarity').value;
    const foil = document.getElementById('filterFoil').value;
    const sort = document.getElementById('selectSort').value;
    
    const params = new URLSearchParams();
    if (selectedBoxId) {
        params.append('box_id', selectedBoxId);
    } else if (selectedSet) {
        params.append('set_code', selectedSet);
    }
    if (search) params.append('q', search);
    if (rarity) params.append('rarity', rarity);
    if (foil !== '') params.append('foil', foil);
    if (sort) params.append('sort', sort);
    
    try {
        const res = await fetch(`/api/cards?${params.toString()}`);
        const data = await res.json();
        allCards = data.cards;
        currentSummary = data.summary;
        thbRate = data.summary.thb_rate || thbRate;
        
        updateSummaryUI(data.summary);
        renderCardsUI();
    } catch (e) {
        console.error('Error fetching cards', e);
        showToast('ไม่สามารถดึงข้อมูลการ์ดได้', 'error');
    }
}

// Update Top KPI Summary
function updateSummaryUI(summary) {
    if (!summary) return;
    
    document.getElementById('totalRetailUsd').textContent = `$${summary.total_retail_usd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('totalRetailThb').textContent = `≈ ฿${Math.round(summary.total_retail_thb).toLocaleString()}`;
    document.getElementById('totalCardsCount').textContent = `${summary.total_count} ใบ (${summary.total_unique} ชนิด)`;
    
    document.getElementById('totalBuyUsd').textContent = `$${summary.total_buy_usd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('totalBuyThb').textContent = `≈ ฿${Math.round(summary.total_buy_thb).toLocaleString()}`;
    
    const ratio = summary.total_retail_usd > 0 ? (summary.total_buy_usd / summary.total_retail_usd) * 100 : 0;
    document.getElementById('cashoutRatio').textContent = `สัดส่วนเงินสดรับซื้อคืน ${ratio.toFixed(1)}%`;
    
    // Top Gainer
    if (summary.top_gainer) {
        document.getElementById('topGainerName').textContent = summary.top_gainer.name;
        document.getElementById('topGainerChange').textContent = `+${summary.top_gainer.price_change_pct.toFixed(1)}%`;
        document.getElementById('topGainerPrice').textContent = `CKD: $${summary.top_gainer.price_retail.toFixed(2)}`;
    } else {
        document.getElementById('topGainerName').textContent = 'ไม่มีการ์ดราคาขึ้น';
        document.getElementById('topGainerChange').textContent = '+0.0%';
        document.getElementById('topGainerPrice').textContent = '-';
    }
    
    // Top Loser
    if (summary.top_loser) {
        document.getElementById('topLoserName').textContent = summary.top_loser.name;
        document.getElementById('topLoserChange').textContent = `${summary.top_loser.price_change_pct.toFixed(1)}%`;
        document.getElementById('topLoserPrice').textContent = `CKD: $${summary.top_loser.price_retail.toFixed(2)}`;
    } else {
        document.getElementById('topLoserName').textContent = 'ไม่มีการ์ดราคาลง';
        document.getElementById('topLoserChange').textContent = '-0.0%';
        document.getElementById('topLoserPrice').textContent = '-';
    }
    
    // Alert Counter
    const alertBadge = document.getElementById('alertCounter');
    if (summary.unread_alerts > 0) {
        alertBadge.textContent = summary.unread_alerts;
        alertBadge.style.display = 'flex';
    } else {
        alertBadge.style.display = 'none';
    }

    // Sales Realized Metrics
    const totalSoldUsd = summary.total_sold_usd || 0;
    const totalSoldThb = summary.total_sold_thb || 0;
    const totalSoldCount = summary.total_sold_count || 0;
    
    const headerSales = document.getElementById('headerSalesText');
    if (headerSales) headerSales.textContent = `Sales: $${totalSoldUsd.toFixed(2)}`;
    
    const elSoldUsd = document.getElementById('totalSoldUsd');
    if (elSoldUsd) elSoldUsd.textContent = `$${totalSoldUsd.toFixed(2)}`;
    
    const elSoldThb = document.getElementById('totalSoldThb');
    if (elSoldThb) elSoldThb.textContent = `≈ ฿${Math.round(totalSoldThb).toLocaleString()}`;
    
    const elSoldCount = document.getElementById('totalSoldCardsCount');
    if (elSoldCount) elSoldCount.textContent = `ขายแล้ว ${totalSoldCount} รายการ (คลิกดูประวัติ)`;

    // Box ROI Banner Updates
    const roiBanner = document.getElementById('boxRoiBanner');
    if (roiBanner) {
        if (summary.box_cost_thb > 0) {
            roiBanner.style.display = 'flex';
            const currentBoxObj = boxesList.find(b => b.id === selectedBoxId);
            const boxDisplayName = currentBoxObj ? currentBoxObj.name : (summary.box_name || 'ทุกรอบเปิดบ็อก (All Boxes)');
            const setCodeTag = currentBoxObj ? `(${currentBoxObj.set_code.toUpperCase()})` : '';
            
            document.getElementById('roiSetName').textContent = `${boxDisplayName} ${setCodeTag}`;
            document.getElementById('roiBoxCount').textContent = selectedBoxId ? '1 บ็อก' : `${summary.box_count || 1} บ็อก`;
            document.getElementById('roiBoxNotes').textContent = summary.box_notes || (currentBoxObj ? currentBoxObj.notes : 'ต้นทุนบ็อกรวม');
            document.getElementById('roiCostThb').textContent = `฿${Math.round(summary.box_cost_thb).toLocaleString()}`;
            document.getElementById('roiPulledThb').textContent = `฿${Math.round(summary.total_retail_thb).toLocaleString()}`;
            document.getElementById('roiSoldThb').textContent = `฿${Math.round(summary.total_sold_thb).toLocaleString()}`;
            
            const badge = document.getElementById('roiStatusBadge');
            const pctEl = document.getElementById('roiPctText');
            const labelEl = document.getElementById('roiStatusLabel');
            
            const sign = summary.roi_pct > 0 ? '+' : '';
            pctEl.textContent = `${sign}${summary.roi_pct.toFixed(1)}%`;
            
            if (summary.is_breakeven) {
                badge.className = 'roi-status-badge profit';
                labelEl.textContent = `🎉 คืนทุนแล้ว (+฿${Math.round(summary.roi_thb).toLocaleString()})`;
            } else {
                badge.className = 'roi-status-badge loss';
                labelEl.textContent = `ขาดอีก ฿${Math.round(Math.abs(summary.roi_thb)).toLocaleString()}`;
            }
        } else {
            if (selectedBoxId || selectedSet) {
                roiBanner.style.display = 'flex';
                const currentBoxObj = boxesList.find(b => b.id === selectedBoxId);
                const boxDisplayName = currentBoxObj ? currentBoxObj.name : (summary.box_name || 'บ็อกที่เลือก');
                document.getElementById('roiSetName').textContent = boxDisplayName;
                document.getElementById('roiBoxCount').textContent = 'ยังไม่ระบุต้นทุน';
                document.getElementById('roiBoxNotes').textContent = 'คลิกปุ่ม "แก้ไขต้นทุน" เพื่อระบุราคาบ็อกที่ซื้อมา';
                document.getElementById('roiCostThb').textContent = '฿0';
                document.getElementById('roiPulledThb').textContent = `฿${Math.round(summary.total_retail_thb).toLocaleString()}`;
                document.getElementById('roiSoldThb').textContent = `฿${Math.round(summary.total_sold_thb).toLocaleString()}`;
                
                const badge = document.getElementById('roiStatusBadge');
                badge.className = 'roi-status-badge';
                badge.style.background = 'rgba(255,255,255,0.05)';
                badge.style.border = '1px solid var(--border-color)';
                document.getElementById('roiPctText').textContent = '-';
                document.getElementById('roiStatusLabel').textContent = 'คลิกตั้งค่าต้นทุนบ็อก';
            } else {
                roiBanner.style.display = 'none';
            }
        }
    }
}

// Render Cards in Grid or Table View
function renderCardsUI() {
    let displayCards = allCards;
    if (filterAlertsOnly) {
        displayCards = displayCards.filter(c => Math.abs(c.price_change_pct) > 0.01);
    }
    
    const grid = document.getElementById('cardsGrid');
    const tableContainer = document.getElementById('cardsTableContainer');
    const tableBody = document.getElementById('cardsTableBody');
    
    if (currentView === 'grid') {
        grid.style.display = 'grid';
        tableContainer.style.display = 'none';
        
        if (displayCards.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: var(--text-muted);">
                <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
                <p>ไม่พบรายการการ์ดที่ค้นหา</p>
            </div>`;
            return;
        }
        
        grid.innerHTML = displayCards.map(c => {
            const retailThb = Math.round(c.price_retail * thbRate);
            const isFoil = c.is_foil === 1;
            const foilTag = isFoil ? `<span class="badge-foil">★ FOIL</span>` : '';
            const rarityClass = c.rarity ? c.rarity.toLowerCase() : 'common';
            
            let changeBadge = '';
            if (c.price_change_pct > 0) {
                changeBadge = `<span class="badge-change badge-up"><i class="fa-solid fa-arrow-trend-up"></i> +${c.price_change_pct.toFixed(1)}%</span>`;
            } else if (c.price_change_pct < 0) {
                changeBadge = `<span class="badge-change badge-down"><i class="fa-solid fa-arrow-trend-down"></i> ${c.price_change_pct.toFixed(1)}%</span>`;
            }
            
            return `
            <div class="card-item ${isFoil ? 'is-foil' : ''}">
                <div class="card-art-box" onclick="openCardChart(${c.id})">
                    <img src="${c.image_uri || 'https://cards.scryfall.io/back.jpg'}" alt="${c.name}" class="card-art-img" loading="lazy">
                    <div class="card-top-badges">
                        <span class="badge-rarity ${rarityClass}">${c.rarity}</span>
                        ${foilTag}
                    </div>
                    <span class="card-store-stock-tag" title="สต็อกคงเหลือในร้าน Card Kingdom (ไม่ใช่การ์ดของคุณ)">
                        <i class="fa-solid fa-store"></i> ร้าน CKD: ${c.qty_retail}
                    </span>
                    <span class="badge-art-picker" onclick="event.stopPropagation(); openVariantModal(${c.id})" title="คลิกเพื่อเลือกอาร์ทการ์ด">
                        <i class="fa-solid fa-palette"></i> #${c.collector_number}
                    </span>
                </div>
                <div class="card-body">
                    <div class="card-name-row">
                        <div class="card-name" onclick="openCardChart(${c.id})">${c.name}</div>
                        ${changeBadge}
                    </div>
                    <div class="card-meta-text">
                        <span style="cursor: pointer; color: #38bdf8;" onclick="openVariantModal(${c.id})" title="เปลี่ยนอาร์ท">
                            ${c.set_code.toUpperCase()} #${c.collector_number}
                        </span>
                        <span class="badge-box-tag" style="margin-left: 0.35rem;" title="บ็อกรอบนี้"><i class="fa-solid fa-box-open"></i> ${c.box_name || 'รอบที่ 1'}</span>
                        <span style="color: var(--text-muted); margin-left: 0.25rem;">• ${c.type_line || 'Magic Card'}</span>
                    </div>
                    
                    <div class="card-price-section">
                        <div class="price-main-row">
                            <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">CKD RETAIL:</span>
                            <div class="price-retail-group">
                                <span class="price-retail-usd">$${c.price_retail.toFixed(2)}</span>
                                <span class="price-retail-thb">≈ ฿${retailThb.toLocaleString()}</span>
                            </div>
                        </div>
                        <div class="price-buylist-row">
                            <span>CKD Buy (รับซื้อ):</span>
                            <span class="price-buy-usd">$${c.price_buy.toFixed(2)}</span>
                        </div>
                    </div>

                    <!-- Clean In-Collection Stock Controller -->
                    <div class="card-my-stock-row">
                        <div class="my-stock-left">
                            <span>ในสต็อก:</span>
                        </div>
                        <div class="stock-stepper" onclick="event.stopPropagation();">
                            <button type="button" class="btn-stock-step btn-minus" onclick="quickStepQty(${c.id}, -1)" title="ลดจำนวน -1 ใบ">
                                <i class="fa-solid fa-minus"></i>
                            </button>
                            <div class="stock-qty-display" onclick="openQtyModal(${c.id})" title="คลิกเพื่อพิมพ์ระบุจำนวน">
                                <strong class="stock-qty-num">${c.qty}</strong>
                                <span class="stock-qty-unit">ใบ</span>
                            </div>
                            <button type="button" class="btn-stock-step btn-plus" onclick="quickStepQty(${c.id}, 1)" title="เพิ่มจำนวน +1 ใบ">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    </div>

                    <div class="card-actions-row">
                        <button class="btn-card-action btn-sell" onclick="openSellModal(${c.id})" title="บันทึกการขายการ์ดนี้">
                            <i class="fa-solid fa-hand-holding-dollar"></i> ขาย
                        </button>
                        <button class="btn-card-action btn-variant" onclick="openVariantModal(${c.id})" title="เลือกอาร์ท / เปลี่ยนแบบการ์ด">
                            <i class="fa-solid fa-palette"></i> อาร์ท
                        </button>
                        <button class="btn-card-action" onclick="openCardChart(${c.id})" title="ดูกราฟประวัติราคา">
                            <i class="fa-solid fa-chart-line"></i> Chart
                        </button>
                        ${c.ck_url ? `
                        <a href="${c.ck_url}" target="_blank" class="btn-card-action" title="เปิดหน้าสินค้า Card Kingdom">
                            <i class="fa-solid fa-arrow-up-right-from-square"></i> CKD
                        </a>` : ''}
                        <button class="btn-card-action btn-delete" onclick="deleteCard(${c.id}, '${c.name.replace(/'/g, "\\'")}')" title="ลบออกจากลิสต์">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
    } else {
        grid.style.display = 'none';
        tableContainer.style.display = 'block';
        
        tableBody.innerHTML = displayCards.map(c => {
            const retailThb = Math.round(c.price_retail * thbRate);
            const isFoil = c.is_foil === 1;
            
            let changeHtml = '-';
            if (c.price_change_pct > 0) {
                changeHtml = `<span class="badge-change badge-up">+${c.price_change_pct.toFixed(1)}%</span>`;
            } else if (c.price_change_pct < 0) {
                changeHtml = `<span class="badge-change badge-down">${c.price_change_pct.toFixed(1)}%</span>`;
            }
            
            return `
            <tr>
                <td>
                    <img src="${c.image_uri || 'https://cards.scryfall.io/back.jpg'}" alt="${c.name}" class="table-art-thumb" onclick="openCardChart(${c.id})">
                </td>
                <td>
                    <strong style="cursor: pointer;" onclick="openCardChart(${c.id})">${c.name}</strong>
                </td>
                <td>
                    <span style="cursor: pointer; color: #38bdf8; font-weight: 600;" onclick="openVariantModal(${c.id})" title="คลิกเพื่อเลือกอาร์ท">
                        ${c.set_code.toUpperCase()} #${c.collector_number}
                    </span>
                    <br>
                    <span class="badge-box-tag" style="margin-top: 0.25rem;">📦 ${c.box_name || 'รอบที่ 1'}</span>
                </td>
                <td><span class="badge-rarity ${c.rarity.toLowerCase()}">${c.rarity}</span></td>
                <td>
                    <div class="table-qty-stepper" title="จำนวนในสต็อก (คลิกเพื่อแก้ไข หรือกด +/-)">
                        <button type="button" class="btn-qty-table" onclick="quickStepQty(${c.id}, -1)" title="ลดจำนวน -1"><i class="fa-solid fa-minus"></i></button>
                        <span class="table-qty-val" onclick="openQtyModal(${c.id})" title="คลิกเพื่อแก้ไขจำนวน">${c.qty} ใบ</span>
                        <button type="button" class="btn-qty-table" onclick="quickStepQty(${c.id}, 1)" title="เพิ่มจำนวน +1"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </td>
                <td><strong class="color-cyan">$${c.price_retail.toFixed(2)}</strong></td>
                <td><strong class="color-green">฿${retailThb.toLocaleString()}</strong></td>
                <td><span class="color-gold">$${c.price_buy.toFixed(2)}</span></td>
                <td>${changeHtml}</td>
                <td>${c.qty_retail}</td>
                <td>
                    <div style="display: flex; gap: 0.35rem;">
                        <button class="btn-card-action btn-sell" onclick="openSellModal(${c.id})" title="บันทึกการขายการ์ดนี้"><i class="fa-solid fa-hand-holding-dollar"></i></button>
                        <button class="btn-card-action btn-variant" onclick="openVariantModal(${c.id})" title="เลือกอาร์ท / เปลี่ยนแบบการ์ด"><i class="fa-solid fa-palette"></i></button>
                        <button class="btn-card-action" onclick="openCardChart(${c.id})"><i class="fa-solid fa-chart-line"></i></button>
                        ${c.ck_url ? `<a href="${c.ck_url}" target="_blank" class="btn-card-action"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}
                        <button class="btn-card-action btn-delete" onclick="deleteCard(${c.id}, '${c.name.replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }
}

// Open Chart Modal
async function openCardChart(cardId) {
    try {
        const res = await fetch(`/api/history/${cardId}`);
        const data = await res.json();
        const card = data.card;
        const history = data.history;
        
        document.getElementById('chartModalTitle').textContent = card.name + (card.is_foil ? ' (FOIL)' : '');
        document.getElementById('chartModalSubtitle').textContent = `${card.set_code.toUpperCase()} #${card.collector_number} • Card Kingdom Price History`;
        document.getElementById('chartCardImage').src = card.image_uri || 'https://cards.scryfall.io/back.jpg';
        document.getElementById('chartModalRetail').textContent = `$${card.price_retail.toFixed(2)}`;
        document.getElementById('chartModalBuy').textContent = `$${card.price_buy.toFixed(2)}`;
        document.getElementById('chartModalThb').textContent = `฿${Math.round(card.price_retail * thbRate).toLocaleString()}`;
        
        const ckLink = document.getElementById('chartModalCkLink');
        if (card.ck_url) {
            ckLink.href = card.ck_url;
            ckLink.style.display = 'inline-flex';
        } else {
            ckLink.style.display = 'none';
        }
        
        renderHistoryChart(history);
        openModal('chartModal');
    } catch (e) {
        console.error('Error fetching card history', e);
        showToast('ไม่สามารถโหลดประวัติราคาได้', 'error');
    }
}

function renderHistoryChart(history) {
    const ctx = document.getElementById('priceHistoryChart').getContext('2d');
    if (priceChart) {
        priceChart.destroy();
    }
    
    const labels = history.map(h => {
        const d = new Date(h.recorded_at);
        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    });
    const retailData = history.map(h => h.price_retail);
    const buyData = history.map(h => h.price_buy);
    
    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'CKD Retail Price ($)',
                    data: retailData,
                    borderColor: '#00e5ff',
                    backgroundColor: 'rgba(0, 229, 255, 0.1)',
                    borderWidth: 2.5,
                    fill: true,
                    tension: 0.25,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: 'CKD Buylist ($)',
                    data: buyData,
                    borderColor: '#ffb703',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.25,
                    pointRadius: 3,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    labels: { color: '#94a3b8', font: { family: 'Prompt', size: 12 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += '$' + context.parsed.y.toFixed(2);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#64748b', font: { family: 'Prompt', size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Prompt', size: 11 },
                        callback: val => '$' + val.toFixed(2)
                    }
                }
            }
        }
    });
}

// Delete Card
async function deleteCard(id, name) {
    if (!confirm(`ต้องการลบ "${name}" ออกจากรายการใช่หรือไม่?`)) return;
    try {
        const res = await fetch(`/api/cards/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast(`ลบ "${name}" แล้ว`, 'success');
            loadCards();
        }
    } catch (e) {
        showToast('ลบการ์ดไม่สำเร็จ', 'error');
    }
}

// Open Alerts Modal & Load Alerts
async function openAlertsModal() {
    try {
        const res = await fetch('/api/alerts');
        const data = await res.json();
        const alertsList = document.getElementById('alertsList');
        
        if (data.alerts.length === 0) {
            alertsList.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                <i class="fa-solid fa-bell-slash" style="font-size: 2rem; margin-bottom: 0.5rem;"></i>
                <p>ยังไม่มีการแจ้งเตือนราคาในขณะนี้</p>
            </div>`;
        } else {
            alertsList.innerHTML = data.alerts.map(a => {
                const isGain = a.change_type === 'INCREASE';
                const icon = isGain ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
                const colorClass = isGain ? 'badge-up' : 'badge-down';
                const sign = isGain ? '+' : '';
                
                return `
                <div class="alert-item ${a.is_read === 0 ? 'unread' : ''}">
                    <img src="${a.image_uri || 'https://cards.scryfall.io/back.jpg'}" alt="" class="alert-item-img">
                    <div class="alert-item-info">
                        <div class="alert-item-title">${a.card_name} ${a.is_foil ? '(FOIL)' : ''}</div>
                        <div class="alert-item-meta">
                            $${a.old_price.toFixed(2)} → <strong style="color: #fff;">$${a.new_price.toFixed(2)}</strong> 
                            • ${a.created_at}
                        </div>
                    </div>
                    <div class="alert-item-change">
                        <span class="badge-change ${colorClass}">
                            <i class="fa-solid ${icon}"></i> ${sign}${a.change_pct.toFixed(1)}%
                        </span>
                    </div>
                </div>`;
            }).join('');
        }
        openModal('alertsModal');
    } catch (e) {
        console.error('Failed to load alerts', e);
    }
}

// Mark Alerts Read
async function markAlertsRead() {
    try {
        await fetch('/api/alerts/mark-read', { method: 'POST' });
        document.getElementById('alertCounter').style.display = 'none';
        document.querySelectorAll('.alert-item.unread').forEach(el => el.classList.remove('unread'));
        showToast('อ่านการแจ้งเตือนทั้งหมดแล้ว', 'success');
    } catch (e) {
        showToast('ไม่สามารถอัปเดตสถานะแจ้งเตือนได้', 'error');
    }
}

// Simulate Price Alert (Demo test)
async function simulatePriceAlert() {
    try {
        // Randomly choose increase or decrease
        const isUp = Math.random() > 0.3;
        const pct = isUp ? (10 + Math.random() * 25) : -(10 + Math.random() * 20);
        
        const res = await fetch('/api/alerts/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pct_change: Math.round(pct * 10) / 10 })
        });
        const data = await res.json();
        
        if (data.success) {
            playAlertSound(data.change_type === 'INCREASE');
            showToast(`🔔 ราคา ${data.card_name} ขยับเป็น $${data.new_price.toFixed(2)} (${data.pct_change > 0 ? '+' : ''}${data.pct_change}%)`, data.pct_change > 0 ? 'success' : 'error');
            await loadCards();
            openAlertsModal();
        }
    } catch (e) {
        showToast('เกิดข้อผิดพลาดในการจำลองการแจ้งเตือน', 'error');
    }
}

// Manual Sync
async function syncPricesNow() {
    const icon = document.getElementById('syncIcon');
    icon.classList.add('fa-spin');
    showToast('กำลังดึงข้อมูลราคาล่าสุดจาก Card Kingdom API...', 'info');
    
    try {
        const res = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force_download: false })
        });
        const data = await res.json();
        icon.classList.remove('fa-spin');
        
        if (data.status === 'success') {
            showToast(`Sync สำเร็จ! อัปเดต ${data.updated_count} การ์ด (${data.new_alerts_count} Alerts ใหม่)`, 'success');
            if (data.new_alerts_count > 0) {
                playAlertSound(true);
            }
            loadCards();
        } else {
            showToast('Sync ล้มเหลว', 'error');
        }
    } catch (e) {
        icon.classList.remove('fa-spin');
        showToast('ไม่สามารถเชื่อมต่อ Card Kingdom ได้', 'error');
    }
}

// Submit Import
async function submitImport() {
    const text = document.getElementById('importCardsText').value.trim();
    if (!text) {
        alert('กรุณากรอกหรือวางรายชื่อการ์ด');
        return;
    }
    
    const isNew = document.getElementById('importBoxModeNew')?.checked;
    const payload = { text };
    
    if (isNew) {
        payload.create_new_box = true;
        payload.new_box_name = document.getElementById('inputNewBoxName').value.trim();
        payload.new_box_set = document.getElementById('inputNewBoxSet').value.trim().toLowerCase();
        payload.new_box_cost = parseFloat(document.getElementById('inputNewBoxCost').value) || 4800;
        payload.new_box_notes = document.getElementById('inputNewBoxNotes').value.trim();
    } else {
        const selBox = document.getElementById('selectImportBox');
        payload.box_id = selBox ? parseInt(selBox.value) : 1;
    }
    
    showToast('กำลังประมวลผลและดึงข้อมูลการ์ด...', 'info');
    try {
        const res = await fetch('/api/cards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (data.success) {
            showToast(`นำเข้าการ์ดสำเร็จ ${data.total_parsed} ใบ เข้าสู่รอบเปิดบ็อกเรียบร้อย!`, 'success');
            closeModal('addCardsModal');
            document.getElementById('importCardsText').value = '';
            
            if (data.box_id) {
                selectedBoxId = data.box_id;
            }
            await loadBoxes();
            await loadCards();
        } else {
            showToast(data.error || 'นำเข้าไม่สำเร็จ', 'error');
        }
    } catch (e) {
        showToast('เกิดข้อผิดพลาดในการนำเข้า', 'error');
    }
}

// Save Settings
async function saveSettings() {
    const rate = parseFloat(document.getElementById('inputThbRate').value) || 34.0;
    const threshold = parseFloat(document.getElementById('inputAlertThreshold').value) || 5.0;
    const interval = parseInt(document.getElementById('inputSyncInterval').value) || 30;
    
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                thb_rate: rate,
                alert_threshold_pct: threshold,
                auto_sync_interval_mins: interval
            })
        });
        
        thbRate = rate;
        document.getElementById('headerThbRate').textContent = `x${thbRate.toFixed(1)}`;
        
        const selScale = document.getElementById('selectDisplayScale')?.value;
        if (selScale) {
            applyDisplayScale(selScale, true);
        }

        closeModal('settingsModal');
        showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
        loadCards();
    } catch (e) {
        showToast('บันทึกการตั้งค่าไม่สำเร็จ', 'error');
    }
}

let currentSellCard = null;
let currentSellMultiplier = 25.0;

// Open Sell Modal
function openSellModal(cardId) {
    const card = allCards.find(c => c.id === cardId);
    if (!card) return;
    currentSellCard = card;

    document.getElementById('sellCardId').value = card.id;
    document.getElementById('sellModalImg').src = card.image_uri || 'https://cards.scryfall.io/back.jpg';
    document.getElementById('sellModalCardName').textContent = card.name + (card.is_foil ? ' (FOIL)' : '');
    document.getElementById('sellModalCardMeta').textContent = `${card.set_code.toUpperCase()} #${card.collector_number} • มีอยู่ในพอร์ต: ${card.qty} ใบ`;
    
    const retailThb = Math.round(card.price_retail * thbRate);
    document.getElementById('sellModalRefRetail').textContent = `$${card.price_retail.toFixed(2)}`;
    document.getElementById('sellModalRefBuy').textContent = `$${card.price_buy.toFixed(2)}`;
    document.getElementById('sellModalRefThb').textContent = `฿${retailThb.toLocaleString()}`;

    // Update system rate chip
    const sysChip = document.getElementById('chipSystemRate');
    if (sysChip) {
        sysChip.textContent = `xเรทระบบ (${thbRate.toFixed(1)})`;
        sysChip.setAttribute('data-rate', thbRate);
    }

    // Default to x25 multiplier in THB
    currentSellMultiplier = 25.0;
    const multInput = document.getElementById('inputSellRateMultiplier');
    if (multInput) multInput.value = currentSellMultiplier;

    // Set currency to THB
    const currencySelect = document.getElementById('selectSellCurrency');
    currencySelect.value = 'THB';
    document.getElementById('sellCurrencySymbol').textContent = '฿';
    
    // Set price
    const calculatedThb = Math.round(card.price_retail * currentSellMultiplier * 100) / 100;
    const priceInput = document.getElementById('inputSellPrice');
    priceInput.value = calculatedThb.toFixed(2);
    
    // Update formula display
    updateRateMultiplierFormula();

    // Set active chip on x25
    document.querySelectorAll('.rate-chip').forEach(ch => {
        ch.classList.toggle('active', parseFloat(ch.getAttribute('data-rate')) === 25);
    });

    const qtyInput = document.getElementById('inputSellQty');
    qtyInput.value = 1;
    qtyInput.max = card.qty;
    
    document.getElementById('inputBuyerNote').value = 'เรท x25';

    // Quick Chips handlers for USD
    document.getElementById('chipCkdRetail').onclick = () => {
        currencySelect.value = 'USD';
        document.getElementById('sellCurrencySymbol').textContent = '$';
        priceInput.value = card.price_retail.toFixed(2);
        document.querySelectorAll('.rate-chip').forEach(ch => ch.classList.remove('active'));
        document.getElementById('inputBuyerNote').value = 'CKD 100%';
    };
    document.getElementById('chipCkd80').onclick = () => {
        currencySelect.value = 'USD';
        document.getElementById('sellCurrencySymbol').textContent = '$';
        priceInput.value = (Math.round(card.price_retail * 0.8 * 100) / 100).toFixed(2);
        document.querySelectorAll('.rate-chip').forEach(ch => ch.classList.remove('active'));
        document.getElementById('inputBuyerNote').value = 'CKD 80%';
    };
    document.getElementById('chipCkdBuy').onclick = () => {
        currencySelect.value = 'USD';
        document.getElementById('sellCurrencySymbol').textContent = '$';
        priceInput.value = card.price_buy.toFixed(2);
        document.querySelectorAll('.rate-chip').forEach(ch => ch.classList.remove('active'));
        document.getElementById('inputBuyerNote').value = 'CKD Buylist';
    };

    openModal('sellCardModal');
}

function selectRateMultiplier(rate, el) {
    currentSellMultiplier = parseFloat(rate) || 25.0;
    const multInput = document.getElementById('inputSellRateMultiplier');
    if (multInput) multInput.value = currentSellMultiplier;

    document.querySelectorAll('.rate-chip').forEach(ch => ch.classList.remove('active'));
    if (el) el.classList.add('active');

    // Switch currency to THB
    const currencySelect = document.getElementById('selectSellCurrency');
    currencySelect.value = 'THB';
    document.getElementById('sellCurrencySymbol').textContent = '฿';

    // Recalculate price
    if (currentSellCard) {
        const calculatedThb = Math.round(currentSellCard.price_retail * currentSellMultiplier * 100) / 100;
        document.getElementById('inputSellPrice').value = calculatedThb.toFixed(2);
        updateRateMultiplierFormula();

        // Update note if default pattern
        const noteInput = document.getElementById('inputBuyerNote');
        if (!noteInput.value || noteInput.value.startsWith('เรท x') || noteInput.value.startsWith('CKD')) {
            noteInput.value = `เรท x${currentSellMultiplier}`;
        }
    }
}

function updateRateMultiplierFormula() {
    if (!currentSellCard) return;
    const mult = parseFloat(document.getElementById('inputSellRateMultiplier')?.value) || currentSellMultiplier || 25.0;
    const ckdUsd = currentSellCard.price_retail || 0;
    const totalThb = Math.round(ckdUsd * mult * 100) / 100;

    const elCkd = document.getElementById('formulaCkdUsd');
    const elRate = document.getElementById('formulaRate');
    const elRes = document.getElementById('formulaResultThb');

    if (elCkd) elCkd.textContent = `$${ckdUsd.toFixed(2)}`;
    if (elRate) elRate.textContent = mult.toFixed(1);
    if (elRes) elRes.textContent = `฿${totalThb.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}

function onSellMultiplierInputChange() {
    const mult = parseFloat(document.getElementById('inputSellRateMultiplier').value);
    if (!isNaN(mult) && mult > 0 && currentSellCard) {
        currentSellMultiplier = mult;
        
        // Highlight matching chip or remove active
        document.querySelectorAll('.rate-chip').forEach(ch => {
            ch.classList.toggle('active', parseFloat(ch.getAttribute('data-rate')) === mult);
        });

        // Switch to THB
        const currencySelect = document.getElementById('selectSellCurrency');
        currencySelect.value = 'THB';
        document.getElementById('sellCurrencySymbol').textContent = '฿';

        const calculatedThb = Math.round(currentSellCard.price_retail * mult * 100) / 100;
        document.getElementById('inputSellPrice').value = calculatedThb.toFixed(2);
        updateRateMultiplierFormula();

        const noteInput = document.getElementById('inputBuyerNote');
        if (!noteInput.value || noteInput.value.startsWith('เรท x') || noteInput.value.startsWith('CKD')) {
            noteInput.value = `เรท x${currentSellMultiplier}`;
        }
    }
}

// Submit Card Sale
async function submitCardSale() {
    const cardId = parseInt(document.getElementById('sellCardId').value);
    const soldPrice = parseFloat(document.getElementById('inputSellPrice').value);
    const currency = document.getElementById('selectSellCurrency').value;
    const qtySold = parseInt(document.getElementById('inputSellQty').value) || 1;
    const buyerNote = document.getElementById('inputBuyerNote').value.trim();
    const rateMultiplier = parseFloat(document.getElementById('inputSellRateMultiplier')?.value) || currentSellMultiplier || 25.0;

    if (isNaN(soldPrice) || soldPrice <= 0) {
        showToast('กรุณาระบุราคาขายที่ถูกต้อง', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/cards/${cardId}/sell`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                qty_sold: qtySold,
                sold_price: soldPrice,
                currency: currency,
                rate_multiplier: rateMultiplier,
                buyer_note: buyerNote
            })
        });
        const data = await res.json();

        if (data.success) {
            playAlertSound(true);
            const rateMsg = data.exchange_rate ? ` (เรท x${data.exchange_rate})` : '';
            showToast(`💰 บันทึกการขาย "${data.card_name}" สำเร็จ! ($${data.sold_price_usd.toFixed(2)} / ฿${Math.round(data.sold_price_thb).toLocaleString()}${rateMsg})`, 'success');
            closeModal('sellCardModal');
            await loadSets();
            await loadCards();
        } else {
            showToast(data.error || 'บันทึกการขายไม่สำเร็จ', 'error');
        }
    } catch (e) {
        showToast('เกิดข้อผิดพลาดในการบันทึกการขาย', 'error');
    }
}

// Open Sales History Modal
async function openSalesModal() {
    try {
        const res = await fetch('/api/sales');
        const data = await res.json();
        
        document.getElementById('salesModalTotalUsd').textContent = `$${data.summary.total_revenue_usd.toFixed(2)}`;
        document.getElementById('salesModalTotalThb').textContent = `฿${Math.round(data.summary.total_revenue_thb).toLocaleString()}`;
        document.getElementById('salesModalCount').textContent = data.summary.total_sales_count;
        
        const tableBody = document.getElementById('salesTableBody');
        if (data.sales.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                <i class="fa-solid fa-receipt" style="font-size: 2rem; margin-bottom: 0.5rem;"></i>
                <p>ยังไม่มีประวัติการขายการ์ด</p>
            </td></tr>`;
        } else {
            tableBody.innerHTML = data.sales.map(s => {
                const foilBadge = s.is_foil ? ' <span class="badge-foil" style="font-size: 0.65rem;">FOIL</span>' : '';
                const rateBadge = s.exchange_rate ? `<span class="badge-change" style="font-size: 0.72rem; padding: 0.1rem 0.35rem; background: rgba(255, 183, 3, 0.15); color: var(--color-gold); border: 1px solid rgba(255, 183, 3, 0.3); margin-left: 0.25rem;">x${s.exchange_rate}</span>` : '';
                return `
                <tr>
                    <td><img src="${s.image_uri || 'https://cards.scryfall.io/back.jpg'}" alt="" class="table-art-thumb"></td>
                    <td><strong>${s.card_name}</strong>${foilBadge}<br><small style="color: var(--text-muted);">${(s.set_code || '').toUpperCase()} #${s.collector_number || ''}</small></td>
                    <td><span class="badge-box-tag">📦 ${s.box_name || 'รอบที่ ' + (s.box_id || 1)}</span></td>
                    <td><small>${s.sold_at}</small></td>
                    <td><strong>x${s.qty_sold}</strong></td>
                    <td><strong class="color-gold">$${s.sold_price_usd.toFixed(2)}</strong></td>
                    <td><strong class="color-green">฿${Math.round(s.sold_price_thb).toLocaleString()}</strong>${rateBadge}</td>
                    <td>$${(s.ck_retail_at_sale || 0).toFixed(2)}</td>
                    <td><small>${s.buyer_note || '-'}</small></td>
                    <td>
                        <button class="btn-card-action btn-delete" onclick="deleteSaleRecord(${s.id})" title="ลบรายการนี้"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`;
            }).join('');
        }
        
        openModal('salesHistoryModal');
    } catch (e) {
        showToast('ไม่สามารถโหลดประวัติการขายได้', 'error');
    }
}

// Delete Sale Record
async function deleteSaleRecord(saleId) {
    if (!confirm('ต้องการลบประวัติการขายรายการนี้ใช่หรือไม่?')) return;
    try {
        const res = await fetch(`/api/sales/${saleId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('ลบรายการขายแล้ว', 'success');
            await openSalesModal();
            loadCards();
        }
    } catch (e) {
        showToast('ไม่สามารถลบรายการขายได้', 'error');
    }
}

// ============================================================
// CARD ART / VARIANT SELECTOR LOGIC
// ============================================================
let currentVariantCardId = null;
let currentVariantCard = null;
let currentVariantsList = [];
let currentVariantFilter = 'all';

async function openVariantModal(cardId) {
    currentVariantCardId = cardId;
    currentVariantFilter = 'all';
    
    // Find card from local state
    currentVariantCard = allCards.find(c => c.id === cardId);
    const modalSubtitle = document.getElementById('variantModalSubtitle');
    if (currentVariantCard) {
        modalSubtitle.textContent = `${currentVariantCard.name} • ${currentVariantCard.set_code.toUpperCase()} #${currentVariantCard.collector_number} (${currentVariantCard.is_foil ? '★ Foil' : 'Non-foil'})`;
    }
    
    // Setup Split Section if qty > 1
    const splitSection = document.getElementById('variantSplitSection');
    const totalQtyText = document.getElementById('variantTotalQtyText');
    const allQtyCount = document.getElementById('variantAllQtyCount');
    const splitQtyInput = document.getElementById('variantSplitQtyInput');
    
    if (currentVariantCard && currentVariantCard.qty > 1) {
        splitSection.style.display = 'flex';
        totalQtyText.textContent = currentVariantCard.qty;
        allQtyCount.textContent = currentVariantCard.qty;
        splitQtyInput.max = currentVariantCard.qty - 1;
        splitQtyInput.value = 1;
        const radioAll = document.querySelector('input[name="variantSplitChoice"][value="all"]');
        if (radioAll) radioAll.checked = true;
        toggleVariantSplitCustom(false);
    } else {
        splitSection.style.display = 'none';
    }

    // Reset UI state
    document.getElementById('variantLoadingState').style.display = 'block';
    document.getElementById('variantEmptyState').style.display = 'none';
    document.getElementById('variantGrid').style.display = 'none';
    document.getElementById('countVarAll').textContent = '0';
    
    // Reset filter chips
    document.querySelectorAll('.variant-filter-chip').forEach(ch => {
        ch.classList.toggle('active', ch.getAttribute('data-filter') === 'all');
    });

    openModal('variantModal');

    try {
        const res = await fetch(`/api/cards/${cardId}/variants`);
        const data = await res.json();
        
        document.getElementById('variantLoadingState').style.display = 'none';
        
        if (data.success && data.variants && data.variants.length > 0) {
            currentVariantsList = data.variants;
            document.getElementById('countVarAll').textContent = currentVariantsList.length;
            renderVariantGrid(currentVariantsList);
        } else {
            document.getElementById('variantEmptyState').style.display = 'block';
        }
    } catch (e) {
        console.error('Error fetching card variants:', e);
        document.getElementById('variantLoadingState').style.display = 'none';
        document.getElementById('variantEmptyState').style.display = 'block';
        showToast('เกิดข้อผิดพลาดในการโหลดรายการอาร์ท', 'error');
    }
}

function openVariantModalFromSell() {
    if (!currentSellCard) return;
    const cardId = currentSellCard.id;
    closeModal('sellCardModal');
    openVariantModal(cardId);
}

function toggleVariantSplitCustom(isSplit) {
    const inputWrapper = document.getElementById('variantSplitInputWrapper');
    const input = document.getElementById('variantSplitQtyInput');
    if (inputWrapper && input) {
        inputWrapper.style.opacity = isSplit ? '1' : '0.5';
        input.disabled = !isSplit;
    }
}

function filterVariants(filterType, el) {
    currentVariantFilter = filterType;
    document.querySelectorAll('.variant-filter-chip').forEach(ch => ch.classList.remove('active'));
    if (el) el.classList.add('active');

    if (!currentVariantsList || currentVariantsList.length === 0) return;

    let filtered = currentVariantsList;
    if (filterType === 'foil') {
        filtered = filtered.filter(v => v.is_foil === 1);
    } else if (filterType !== 'all') {
        filtered = filtered.filter(v => v.treatment.toLowerCase().includes(filterType.toLowerCase()));
    }
    
    renderVariantGrid(filtered);
}

function renderVariantGrid(variants) {
    const grid = document.getElementById('variantGrid');
    const empty = document.getElementById('variantEmptyState');
    
    if (variants.length === 0) {
        grid.style.display = 'none';
        empty.style.display = 'block';
        return;
    }
    
    empty.style.display = 'none';
    grid.style.display = 'grid';

    grid.innerHTML = variants.map((v, idx) => {
        const isCurrent = v.is_current;
        const retailThb = Math.round(v.price_retail * thbRate);
        const isFoil = v.is_foil === 1;

        let treatmentClass = 'regular';
        const tLower = v.treatment.toLowerCase();
        if (tLower.includes('borderless')) treatmentClass = 'borderless';
        else if (tLower.includes('showcase')) treatmentClass = 'showcase';
        else if (tLower.includes('extended')) treatmentClass = 'extended-art';

        const foilBadge = isFoil ? `<span class="badge-foil">★ FOIL</span>` : '';
        const currentBadge = isCurrent ? `<span class="badge-current-tag"><i class="fa-solid fa-check"></i> อาร์ทปัจจุบัน</span>` : '';

        return `
        <div class="variant-card ${isCurrent ? 'is-current' : ''}">
            <div class="variant-thumb-container">
                <img src="${v.image_uri || 'https://cards.scryfall.io/back.jpg'}" alt="${v.name}" class="variant-thumb-img" loading="lazy">
                <div class="variant-badges-overlay">
                    <span class="badge-treatment ${treatmentClass}">${v.treatment}</span>
                    ${foilBadge}
                </div>
                ${currentBadge}
            </div>
            <div class="variant-info-body">
                <div class="variant-meta-row">
                    <span class="variant-cnum">#${v.collector_number}</span>
                    <span style="font-size: 0.72rem; color: var(--text-muted);">${v.finish_label}</span>
                </div>
                
                <div class="variant-prices-box">
                    <div class="variant-price-row">
                        <span style="color: var(--text-muted); font-size: 0.72rem;">CKD Retail:</span>
                        <div>
                            <strong class="color-cyan">$${v.price_retail.toFixed(2)}</strong>
                            <span style="font-size: 0.72rem; color: var(--text-muted); margin-left: 0.2rem;">(฿${retailThb.toLocaleString()})</span>
                        </div>
                    </div>
                    <div class="variant-price-row">
                        <span style="color: var(--text-muted); font-size: 0.72rem;">CKD Buy:</span>
                        <span class="color-gold">$${v.price_buy.toFixed(2)}</span>
                    </div>
                </div>

                ${isCurrent ? `
                    <button class="btn-select-variant action-current" disabled>
                        <i class="fa-solid fa-check-circle"></i> แบบปัจจุบัน
                    </button>
                ` : `
                    <button class="btn-select-variant action-active" onclick="applyCardVariant(${idx})">
                        <i class="fa-solid fa-check"></i> เลือกอาร์ทนี้
                    </button>
                `}
            </div>
        </div>`;
    }).join('');
}

async function applyCardVariant(variantIndex) {
    const variant = currentVariantsList[variantIndex];
    if (!variant || !currentVariantCardId) return;

    // Check if splitting
    let splitQty = 0;
    const splitChoice = document.querySelector('input[name="variantSplitChoice"]:checked')?.value;
    if (splitChoice === 'split') {
        const inputVal = parseInt(document.getElementById('variantSplitQtyInput')?.value);
        if (inputVal > 0 && currentVariantCard && inputVal < currentVariantCard.qty) {
            splitQty = inputVal;
        }
    }

    try {
        const res = await fetch(`/api/cards/${currentVariantCardId}/variant`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scryfall_id: variant.scryfall_id,
                collector_number: variant.collector_number,
                is_foil: variant.is_foil,
                image_uri: variant.image_uri,
                treatment: variant.treatment,
                price_retail: variant.price_retail,
                price_buy: variant.price_buy,
                qty_retail: variant.qty_retail,
                ck_id: variant.ck_id,
                ck_url: variant.ck_url,
                split_qty: splitQty
            })
        });

        const data = await res.json();
        if (data.success) {
            playAlertSound(true);
            const foilTxt = variant.is_foil ? ' ★Foil' : '';
            const splitTxt = splitQty > 0 ? ` (แยก ${splitQty} ใบ)` : '';
            showToast(`🎨 อัปเดตเป็น #${variant.collector_number} ${variant.treatment}${foilTxt}${splitTxt} สำเร็จ! ($${variant.price_retail.toFixed(2)} / ฿${Math.round(variant.price_retail * thbRate).toLocaleString()})`, 'success');
            
            closeModal('variantModal');
            await loadSets();
            await loadCards();
        } else {
            showToast(data.error || 'เกิดข้อผิดพลาดในการเปลี่ยนอาร์ท', 'error');
        }
    } catch (e) {
        console.error('Error applying variant:', e);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
    }
}

// ============================================================
// CARD QUANTITY MANAGEMENT LOGIC
// ============================================================
let currentQtyCardId = null;
let currentQtyCard = null;

// Quick +/- step right on card
async function quickStepQty(cardId, delta) {
    const card = allCards.find(c => c.id === cardId);
    if (!card) return;

    const newQty = card.qty + delta;
    if (newQty <= 0) {
        if (!confirm(`ต้องการลบการ์ด "${card.name}" ออกจากคลังสต็อกใช่หรือไม่?`)) {
            return;
        }
    }

    try {
        const res = await fetch(`/api/cards/${cardId}/qty`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qty: newQty })
        });
        const data = await res.json();
        if (data.success) {
            playAlertSound(false);
            if (data.deleted) {
                showToast(`🗑️ ลบ "${card.name}" ออกจากคลังเรียบร้อย`, 'success');
            } else {
                showToast(`📦 ปรับจำนวน "${card.name}" เป็น ${newQty} ใบ`, 'success');
            }
            await loadSets();
            await loadCards();
        } else {
            showToast(data.error || 'ไม่สามารถปรับจำนวนได้', 'error');
        }
    } catch (e) {
        console.error('Error updating qty:', e);
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
}

// Open Quantity Edit Modal
function openQtyModal(cardId) {
    currentQtyCardId = cardId;
    currentQtyCard = allCards.find(c => c.id === cardId);
    if (!currentQtyCard) return;

    document.getElementById('qtyModalCardName').textContent = currentQtyCard.name + (currentQtyCard.is_foil ? ' (★ Foil)' : '');
    document.getElementById('qtyModalMeta').textContent = `${currentQtyCard.set_code.toUpperCase()} #${currentQtyCard.collector_number} • CKD Retail: $${currentQtyCard.price_retail.toFixed(2)}`;
    document.getElementById('qtyModalImg').src = currentQtyCard.image_uri || 'https://cards.scryfall.io/back.jpg';
    
    const input = document.getElementById('inputQtyModalValue');
    input.value = currentQtyCard.qty;
    
    updateQtyModalCalc();
    openModal('qtyModal');
    
    setTimeout(() => {
        input.focus();
        input.select();
    }, 150);
}

function stepQtyModalInput(delta) {
    const input = document.getElementById('inputQtyModalValue');
    let val = parseInt(input.value) || 0;
    val = Math.max(0, val + delta);
    input.value = val;
    updateQtyModalCalc();
}

function setQtyModalValue(val) {
    const input = document.getElementById('inputQtyModalValue');
    input.value = val;
    updateQtyModalCalc();
}

function updateQtyModalCalc() {
    if (!currentQtyCard) return;
    const input = document.getElementById('inputQtyModalValue');
    const qty = parseInt(input.value) || 0;
    const retailUsd = currentQtyCard.price_retail * qty;
    const retailThb = Math.round(retailUsd * thbRate);

    document.getElementById('qtyCalcUsd').textContent = `$${retailUsd.toFixed(2)}`;
    document.getElementById('qtyCalcThb').textContent = `฿${retailThb.toLocaleString()}`;
}

async function submitQtyModal() {
    if (!currentQtyCardId || !currentQtyCard) return;
    const input = document.getElementById('inputQtyModalValue');
    const newQty = parseInt(input.value);
    
    if (isNaN(newQty) || newQty < 0) {
        showToast('กรุณาระบุจำนวนที่ถูกต้อง (0 ขึ้นไป)', 'error');
        return;
    }

    if (newQty === 0) {
        if (!confirm(`จำนวนเป็น 0 — ต้องการลบการ์ด "${currentQtyCard.name}" ออกจากคลังใช่หรือไม่?`)) {
            return;
        }
    }

    try {
        const res = await fetch(`/api/cards/${currentQtyCardId}/qty`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qty: newQty })
        });
        const data = await res.json();
        if (data.success) {
            playAlertSound(true);
            if (data.deleted) {
                showToast(`🗑️ ลบ "${currentQtyCard.name}" ออกจากคลังเรียบร้อย`, 'success');
            } else {
                showToast(`📦 บันทึกจำนวน "${currentQtyCard.name}" เป็น ${newQty} ใบสำเร็จ!`, 'success');
            }
            closeModal('qtyModal');
            await loadSets();
            await loadCards();
        } else {
            showToast(data.error || 'ไม่สามารถบันทึกจำนวนได้', 'error');
        }
    } catch (e) {
        console.error('Error saving qty modal:', e);
        showToast('เกิดข้อผิดพลาดในการบันทึกจำนวน', 'error');
    }
}

// Toggle Import Box Mode in Add Cards Modal
function toggleImportBoxMode() {
    const isNew = document.getElementById('importBoxModeNew')?.checked;
    const existCont = document.getElementById('importExistingBoxContainer');
    const newCont = document.getElementById('importNewBoxContainer');
    if (existCont) existCont.style.display = isNew ? 'none' : 'block';
    if (newCont) {
        newCont.style.display = isNew ? 'block' : 'none';
        if (isNew) {
            const nextNum = boxesList.length + 1;
            const nameInput = document.getElementById('inputNewBoxName');
            if (nameInput && !nameInput.value) {
                nameInput.value = `รอบที่ ${nextNum} (Box #${nextNum})`;
            }
        }
    }
}

// Load Boxes & Round Tabs
async function loadBoxes() {
    try {
        const res = await fetch('/api/boxes');
        const data = await res.json();
        boxesList = data.boxes || [];
        
        // Populate select in Box Cost Modal
        const selectCostBox = document.getElementById('selectCostBox');
        if (selectCostBox) {
            let optionsHtml = boxesList.map(b => 
                `<option value="${b.id}">${b.name} (${(b.set_code || 'FRA').toUpperCase()}) — ฿${Math.round(b.box_cost_thb).toLocaleString()} [${b.card_count} ใบ]</option>`
            ).join('');
            optionsHtml += `<option value="new">➕ [เปิดบ็อกรอบใหม่ / New Box]</option>`;
            selectCostBox.innerHTML = optionsHtml;
        }

        // Populate select in Import Modal
        const selectImportBox = document.getElementById('selectImportBox');
        if (selectImportBox) {
            selectImportBox.innerHTML = boxesList.map(b => 
                `<option value="${b.id}">${b.name} (${(b.set_code || 'FRA').toUpperCase()}) — ต้นทุน ฿${Math.round(b.box_cost_thb).toLocaleString()} (มีการ์ดอยู่ ${b.card_count} ใบ)</option>`
            ).join('');
            if (selectedBoxId) {
                selectImportBox.value = selectedBoxId;
            }
        }
        
        // Populate select in Export Modal
        const selectExportSet = document.getElementById('selectExportSet');
        if (selectExportSet) {
            let exportOpts = `<option value="">ทุกรอบรวมกัน (All Boxes & Sets)</option>`;
            exportOpts += boxesList.map(b => 
                `<option value="box_${b.id}">📦 ${b.name} (${(b.set_code || 'FRA').toUpperCase()})</option>`
            ).join('');
            selectExportSet.innerHTML = exportOpts;
        }
        
        // Render Box Tabs
        const container = document.getElementById('setsTabsContainer');
        if (!container) return;
        
        const totalCards = boxesList.reduce((acc, b) => acc + b.card_count, 0);
        let tabsHtml = `
            <div class="set-tab ${selectedBoxId === null ? 'active' : ''}" onclick="selectBoxTab(null)">
                <i class="fa-solid fa-layer-group"></i>
                <span>ทุกรอบ (All Boxes)</span>
                <span class="set-tab-count">${totalCards}</span>
            </div>
        `;
        
        tabsHtml += boxesList.map(b => {
            const isAct = (selectedBoxId === b.id);
            const breakevenIcon = b.is_breakeven ? ' 🎉' : '';
            return `
            <div class="set-tab ${isAct ? 'active' : ''}" onclick="selectBoxTab(${b.id})" title="${b.notes || b.name}">
                <span class="set-tab-code">📦 ${b.name}</span>
                <span style="font-size: 0.72rem; color: ${b.is_breakeven ? 'var(--color-green)' : 'var(--text-muted)'};">${(b.set_code||'').toUpperCase()}${breakevenIcon}</span>
                <span class="set-tab-count">${b.card_count}</span>
            </div>
        `}).join('');
        
        container.innerHTML = tabsHtml;
    } catch (e) {
        console.error('Failed to load boxes', e);
    }
}

// Backwards compatibility alias
async function loadSets() {
    await loadBoxes();
}

function selectBoxTab(boxId) {
    selectedBoxId = boxId;
    selectedSet = '';
    loadBoxes();
    loadCards();
}

function selectSetTab(setCode) {
    selectedSet = setCode;
    selectedBoxId = null;
    loadBoxes();
    loadCards();
}

function openBoxCostModal(boxId) {
    const targetBoxId = boxId || selectedBoxId || (boxesList.length > 0 ? boxesList[0].id : 1);
    const selectCostBox = document.getElementById('selectCostBox');
    if (selectCostBox) {
        selectCostBox.value = targetBoxId;
    }
    onSelectCostBoxChange();
    openModal('boxCostModal');
}

function openNewBoxPrompt() {
    openModal('boxCostModal');
    const selectCostBox = document.getElementById('selectCostBox');
    if (selectCostBox) {
        selectCostBox.value = 'new';
        onSelectCostBoxChange();
    }
}

function onSelectCostBoxChange() {
    const selectCostBox = document.getElementById('selectCostBox');
    if (!selectCostBox) return;
    const val = selectCostBox.value;
    const btnDelete = document.getElementById('btnDeleteBox');
    const metricsDiv = document.getElementById('costBoxMetrics');
    
    if (val === 'new') {
        const nextNum = boxesList.length + 1;
        document.getElementById('inputEditBoxName').value = `รอบที่ ${nextNum} (Box #${nextNum})`;
        document.getElementById('inputEditBoxSet').value = 'FRA';
        document.getElementById('inputEditBoxCost').value = 4800;
        document.getElementById('inputEditBoxNotes').value = `ซื้อบ็อกรอบที่ ${nextNum}`;
        if (btnDelete) btnDelete.style.display = 'none';
        if (metricsDiv) metricsDiv.style.display = 'none';
    } else {
        const boxId = parseInt(val);
        const b = boxesList.find(x => x.id === boxId);
        if (b) {
            document.getElementById('inputEditBoxName').value = b.name;
            document.getElementById('inputEditBoxSet').value = (b.set_code || 'FRA').toUpperCase();
            document.getElementById('inputEditBoxCost').value = b.box_cost_thb || 4800;
            document.getElementById('inputEditBoxNotes').value = b.notes || '';
            
            if (metricsDiv) {
                metricsDiv.style.display = 'flex';
                document.getElementById('costBoxCardCount').textContent = `${b.card_count} ใบ`;
                document.getElementById('costBoxRetailThb').textContent = `฿${Math.round(b.retail_thb).toLocaleString()}`;
                document.getElementById('costBoxSoldThb').textContent = `฿${Math.round(b.sold_thb).toLocaleString()}`;
                const badge = document.getElementById('costBoxRoiBadge');
                const roiText = document.getElementById('costBoxRoiText');
                if (badge && roiText) {
                    const sign = b.roi_pct > 0 ? '+' : '';
                    roiText.textContent = `${sign}${b.roi_pct.toFixed(1)}% ROI`;
                    badge.className = b.is_breakeven ? 'roi-status-badge profit' : 'roi-status-badge loss';
                }
            }
            
            // Allow delete if not default box 1
            if (btnDelete) {
                btnDelete.style.display = (boxId !== 1) ? 'inline-flex' : 'none';
            }
        }
    }
}

async function submitBoxCost() {
    const selectCostBox = document.getElementById('selectCostBox');
    const isNew = (selectCostBox && selectCostBox.value === 'new');
    const boxId = isNew ? null : parseInt(selectCostBox.value);
    
    const name = document.getElementById('inputEditBoxName').value.trim();
    const setCode = document.getElementById('inputEditBoxSet').value.trim().toLowerCase();
    const costThb = parseFloat(document.getElementById('inputEditBoxCost').value) || 0;
    const notes = document.getElementById('inputEditBoxNotes').value.trim();
    
    try {
        let res;
        if (isNew) {
            res = await fetch('/api/boxes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, set_code: setCode, box_cost_thb: costThb, notes })
            });
        } else {
            res = await fetch(`/api/boxes/${boxId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, set_code: setCode, box_cost_thb: costThb, notes })
            });
        }
        const data = await res.json();
        if (data.success) {
            playAlertSound(true);
            showToast(`บันทึกข้อมูล "${name}" เรียบร้อยแล้ว`, 'success');
            closeModal('boxCostModal');
            if (isNew && data.box && data.box.id) {
                selectedBoxId = data.box.id;
            }
            await loadBoxes();
            await loadCards();
        } else {
            showToast(data.error || 'เกิดข้อผิดพลาดในการบันทึก', 'error');
        }
    } catch (e) {
        showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    }
}

async function deleteCurrentBox() {
    const selectCostBox = document.getElementById('selectCostBox');
    if (!selectCostBox || selectCostBox.value === 'new') return;
    const boxId = parseInt(selectCostBox.value);
    if (boxId === 1) {
        alert('ไม่สามารถลบรอบที่ 1 (Default) ได้');
        return;
    }
    
    if (!confirm('ยืนยันลบรอบนี้? หากมีการ์ดอยู่ในการ์ดจะถูกย้ายกลับไปรวมที่รอบที่ 1')) return;
    
    try {
        const res = await fetch(`/api/boxes/${boxId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('ลบรอบสำเร็จ และย้ายการ์ดกลับไปยังรอบที่ 1 เรียบร้อย', 'success');
            closeModal('boxCostModal');
            selectedBoxId = 1;
            await loadBoxes();
            await loadCards();
        } else {
            showToast(data.error || 'ไม่สามารถลบได้', 'error');
        }
    } catch (e) {
        showToast('เกิดข้อผิดพลาดในการลบ', 'error');
    }
}

// ==========================================================================
// Export Reports Management
// ==========================================================================
let selectedExportType = 'inventory';

function openExportModal() {
    const selectSet = document.getElementById('selectExportSet');
    if (selectSet) {
        let optionsHtml = '<option value="">ทุกรอบรวมกัน (All Boxes & Sets)</option>';
        optionsHtml += boxesList.map(b => `<option value="box_${b.id}">📦 ${b.name} (${(b.set_code || 'FRA').toUpperCase()}) - ${b.card_count} ใบ</option>`).join('');
        selectSet.innerHTML = optionsHtml;
        if (selectedBoxId) {
            selectSet.value = `box_${selectedBoxId}`;
        }
    }
    openModal('exportModal');
}

function selectExportType(type, el) {
    selectedExportType = type;
    document.querySelectorAll('.export-type-card').forEach(card => card.classList.remove('active'));
    if (el) el.classList.add('active');
}

function downloadExportCsv() {
    const rawVal = document.getElementById('selectExportSet') ? document.getElementById('selectExportSet').value : '';
    let queryParam = '';
    if (rawVal.startsWith('box_')) {
        queryParam = `box_id=${encodeURIComponent(rawVal.replace('box_', ''))}`;
    } else if (rawVal) {
        queryParam = `set_code=${encodeURIComponent(rawVal)}`;
    }
    const url = `/api/export/csv?type=${selectedExportType}&${queryParam}`;
    
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', '');
    document.body.appendChild(link);
    link.click();
    link.remove();
    
    showToast('กำลังดาวน์โหลดรายงาน CSV (Excel UTF-8)...', 'success');
}

async function copySummaryText() {
    const rawVal = document.getElementById('selectExportSet') ? document.getElementById('selectExportSet').value : '';
    let queryParam = '';
    if (rawVal.startsWith('box_')) {
        queryParam = `box_id=${encodeURIComponent(rawVal.replace('box_', ''))}`;
    } else if (rawVal) {
        queryParam = `set_code=${encodeURIComponent(rawVal)}`;
    }
    try {
        const res = await fetch(`/api/export/summary-text?${queryParam}`);
        const data = await res.json();
        if (data.text) {
            await navigator.clipboard.writeText(data.text);
            showToast('คัดลอกสรุปข้อความสำเร็จ! นำไปวางใน LINE/Discord/FB ได้ทันที', 'success');
        } else {
            showToast('ไม่สามารถสร้างสรุปข้อความได้', 'error');
        }
    } catch (e) {
        console.error('Failed to copy summary text', e);
        showToast('เกิดข้อผิดพลาดในการคัดลอก', 'error');
    }
}

async function openPrintableReport() {
    const rawVal = document.getElementById('selectExportSet') ? document.getElementById('selectExportSet').value : '';
    let targetBoxId = null;
    let setCode = '';
    if (rawVal.startsWith('box_')) {
        targetBoxId = parseInt(rawVal.replace('box_', ''));
    } else if (rawVal) {
        setCode = rawVal;
    }
    
    const area = document.getElementById('printableContentArea');
    if (!area) return;
    
    area.innerHTML = '<div style="text-align: center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p style="margin-top: 0.5rem;">กำลังสร้างรายงาน...</p></div>';
    openModal('printableReportModal');
    
    try {
        const nowStr = new Date().toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
        let setLabel = 'ทุกรอบรวมกัน (All Boxes & Sets)';
        if (targetBoxId) {
            const b = boxesList.find(x => x.id === targetBoxId);
            setLabel = b ? `📦 ${b.name} (${(b.set_code || 'FRA').toUpperCase()})` : `Box #${targetBoxId}`;
        } else if (setCode) {
            setLabel = setCode.toUpperCase();
        }
        
        let html = '';
        
        if (selectedExportType === 'sales') {
            const res = await fetch('/api/sales');
            const data = await res.json();
            let sales = data.sales || [];
            if (targetBoxId) {
                sales = sales.filter(s => s.box_id === targetBoxId);
            } else if (setCode) {
                sales = sales.filter(s => s.set_code === setCode);
            }
            
            const totalQty = sales.reduce((acc, s) => acc + s.qty_sold, 0);
            const totalUsd = sales.reduce((acc, s) => acc + (s.sold_price_usd * s.qty_sold), 0);
            const totalThb = sales.reduce((acc, s) => acc + (s.sold_price_thb * s.qty_sold), 0);
            
            html = `
                <div class="print-sheet">
                    <div class="print-sheet-header">
                        <div>
                            <h1>MTG Card Sales & Transactions Report</h1>
                            <div class="print-meta">รายงานประวัติการขายการ์ด MTG • ขอบเขต: ${setLabel}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 700; color: #0f172a;">Card Kingdom Tracker</div>
                            <div class="print-meta">วันที่พิมพ์: ${nowStr}</div>
                            <div class="print-meta">เรทเงินบาท: x${thbRate} THB/USD</div>
                        </div>
                    </div>
                    
                    <div class="print-kpi-row">
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">จำนวนรายการที่ขาย</div>
                            <div class="print-kpi-val">${sales.length}</div>
                            <div class="print-kpi-sub">รายการ</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">จำนวนการ์ดที่ขาย</div>
                            <div class="print-kpi-val">${totalQty}</div>
                            <div class="print-kpi-sub">ใบ</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">ยอดขายรวม (USD)</div>
                            <div class="print-kpi-val" style="color: #b45309;">$${totalUsd.toFixed(2)}</div>
                            <div class="print-kpi-sub">USD</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">ยอดขายรวม (บาท)</div>
                            <div class="print-kpi-val" style="color: #059669;">฿${Math.round(totalThb).toLocaleString()}</div>
                            <div class="print-kpi-sub">THB Realized</div>
                        </div>
                    </div>
                    
                    <table class="print-table">
                        <thead>
                            <tr>
                                <th style="width: 35px;">#</th>
                                <th>ชื่อการ์ด</th>
                                <th>ชุด</th>
                                <th>รูปแบบ</th>
                                <th class="text-center">จำนวน</th>
                                <th class="text-right">ราคาขาย ($)</th>
                                <th class="text-right">ราคาขาย (บาท)</th>
                                <th class="text-right">ยอดรวม (บาท)</th>
                                <th>บันทึกผู้ซื้อ / ช่องทาง</th>
                                <th>วันที่ขาย</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sales.map((s, idx) => `
                                <tr>
                                    <td>${idx + 1}</td>
                                    <td style="font-weight: 600;">${s.card_name}</td>
                                    <td>${(s.set_code || '').toUpperCase()} #${s.collector_number || ''}</td>
                                    <td>${s.is_foil ? '<span class="print-badge-foil">★ Foil</span>' : 'Regular'}</td>
                                    <td class="text-center">${s.qty_sold}</td>
                                    <td class="text-right">$${s.sold_price_usd.toFixed(2)}</td>
                                    <td class="text-right">฿${Math.round(s.sold_price_thb).toLocaleString()}</td>
                                    <td class="text-right" style="font-weight: 700; color: #059669;">฿${Math.round(s.sold_price_thb * s.qty_sold).toLocaleString()}</td>
                                    <td style="color: #64748b;">${s.buyer_note || '-'}</td>
                                    <td>${s.sold_at}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="print-footer-notes">
                        <div>หมายเหตุ: ยอดเงินคำนวณตามอัตราแลกเปลี่ยน ณ เวลาขายจริงหรือที่บันทึกไว้</div>
                        <div>Generated by MTG Card Kingdom Realtime Tracker</div>
                    </div>
                </div>
            `;
        } else if (selectedExportType === 'box_roi') {
            const res = await fetch('/api/sets');
            const data = await res.json();
            let sets = data.sets || [];
            if (setCode) {
                sets = sets.filter(s => s.set_code === setCode);
            }
            
            const totalCost = sets.reduce((acc, s) => acc + s.total_cost_thb, 0);
            const totalRetail = sets.reduce((acc, s) => acc + s.retail_thb, 0);
            const totalSold = sets.reduce((acc, s) => acc + s.sold_thb, 0);
            const totalNet = totalRetail + totalSold;
            const netRoiThb = totalNet - totalCost;
            const netRoiPct = totalCost > 0 ? ((totalNet / totalCost) - 1.0) * 100 : 0;
            
            html = `
                <div class="print-sheet">
                    <div class="print-sheet-header">
                        <div>
                            <h1>MTG Booster Box ROI & Financial Performance</h1>
                            <div class="print-meta">รายงานผลประกอบการและอัตราผลตอบแทนจากการเปิดบ็อก • ขอบเขต: ${setLabel}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 700; color: #0f172a;">Card Kingdom Tracker</div>
                            <div class="print-meta">วันที่พิมพ์: ${nowStr}</div>
                            <div class="print-meta">เรทเงินบาท: x${thbRate} THB/USD</div>
                        </div>
                    </div>
                    
                    <div class="print-kpi-row">
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">ต้นทุนบ็อกรวม</div>
                            <div class="print-kpi-val" style="color: #0284c7;">฿${Math.round(totalCost).toLocaleString()}</div>
                            <div class="print-kpi-sub">Total Cost</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">มูลค่าการ์ดที่ยังถือ</div>
                            <div class="print-kpi-val">฿${Math.round(totalRetail).toLocaleString()}</div>
                            <div class="print-kpi-sub">CKD Retail Portfolio</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">เงินสดขายการ์ดแล้ว</div>
                            <div class="print-kpi-val" style="color: #b45309;">฿${Math.round(totalSold).toLocaleString()}</div>
                            <div class="print-kpi-sub">Realized Cashflow</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">กำไร / ขาดทุนสุทธิ (ROI)</div>
                            <div class="print-kpi-val" style="color: ${netRoiThb >= 0 ? '#059669' : '#dc2626'};">
                                ${netRoiThb >= 0 ? '+' : ''}฿${Math.round(netRoiThb).toLocaleString()}
                            </div>
                            <div class="print-kpi-sub" style="color: ${netRoiPct >= 0 ? '#059669' : '#dc2626'};">
                                ${netRoiPct >= 0 ? '+' : ''}${netRoiPct.toFixed(1)}% ROI
                            </div>
                        </div>
                    </div>
                    
                    <table class="print-table">
                        <thead>
                            <tr>
                                <th>รหัสชุด</th>
                                <th>ชื่อชุด</th>
                                <th class="text-center">จำนวนบ็อก</th>
                                <th class="text-right">ต้นทุน/บ็อก</th>
                                <th class="text-right">ต้นทุนรวม (บาท)</th>
                                <th class="text-right">การ์ดในมือ (บาท)</th>
                                <th class="text-right">ขายแล้ว (บาท)</th>
                                <th class="text-right">มูลค่ารวมสุทธิ</th>
                                <th class="text-right">กำไร/ขาดทุน</th>
                                <th class="text-right">ROI (%)</th>
                                <th class="text-center">สถานะ</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${sets.map(s => {
                                const isProf = s.roi_thb >= 0 && s.total_cost_thb > 0;
                                return `
                                <tr>
                                    <td style="font-weight: 700; text-transform: uppercase;">${s.set_code}</td>
                                    <td style="font-weight: 600;">${s.set_name}</td>
                                    <td class="text-center">${s.box_count || '-'}</td>
                                    <td class="text-right">฿${Math.round(s.cost_per_box_thb).toLocaleString()}</td>
                                    <td class="text-right" style="font-weight: 700;">฿${Math.round(s.total_cost_thb).toLocaleString()}</td>
                                    <td class="text-right">฿${Math.round(s.retail_thb).toLocaleString()}</td>
                                    <td class="text-right" style="color: #b45309;">฿${Math.round(s.sold_thb).toLocaleString()}</td>
                                    <td class="text-right" style="font-weight: 700;">฿${Math.round(s.net_value_thb).toLocaleString()}</td>
                                    <td class="text-right" style="font-weight: 700; color: ${isProf ? '#059669' : (s.total_cost_thb > 0 ? '#dc2626' : '#64748b')};">
                                        ${s.roi_thb > 0 ? '+' : ''}฿${Math.round(s.roi_thb).toLocaleString()}
                                    </td>
                                    <td class="text-right" style="font-weight: 700; color: ${isProf ? '#059669' : (s.total_cost_thb > 0 ? '#dc2626' : '#64748b')};">
                                        ${s.roi_pct > 0 ? '+' : ''}${s.roi_pct.toFixed(1)}%
                                    </td>
                                    <td class="text-center">
                                        ${s.total_cost_thb > 0 ? (s.is_breakeven ? '<span style="color:#059669; font-weight:700;">คืนทุน 🎉</span>' : '<span style="color:#dc2626; font-weight:700;">ยังไม่คืนทุน</span>') : '<span style="color:#94a3b8;">ยังไม่ตั้งต้นทุน</span>'}
                                    </td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                    
                    <div class="print-footer-notes">
                        <div>* มูลค่ารวมสุทธิ = มูลค่าการ์ดที่ยังถือ (อิงราคา CKD Retail x เรทบาท) + ยอดเงินที่ขายการ์ดออกไปแล้ว</div>
                        <div>Generated by MTG Card Kingdom Realtime Tracker</div>
                    </div>
                </div>
            `;
        } else {
            // Inventory
            const params = new URLSearchParams();
            if (targetBoxId) {
                params.append('box_id', targetBoxId);
            } else if (setCode) {
                params.append('set_code', setCode);
            }
            params.append('sort', 'price_retail_desc');
            const res = await fetch(`/api/cards?${params.toString()}`);
            const data = await res.json();
            const cards = data.cards || [];
            const summary = data.summary || {};
            
            html = `
                <div class="print-sheet">
                    <div class="print-sheet-header">
                        <div>
                            <h1>MTG Card Portfolio & Inventory Report</h1>
                            <div class="print-meta">รายงานพอร์ตการ์ดและมูลค่าประเมิน Card Kingdom • ขอบเขต: ${setLabel}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-weight: 700; color: #0f172a;">Card Kingdom Tracker</div>
                            <div class="print-meta">วันที่พิมพ์: ${nowStr}</div>
                            <div class="print-meta">เรทเงินบาท: x${thbRate} THB/USD</div>
                        </div>
                    </div>
                    
                    <div class="print-kpi-row">
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">มูลค่ารวม CKD Retail ($)</div>
                            <div class="print-kpi-val" style="color: #0284c7;">$${(summary.total_retail_usd || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                            <div class="print-kpi-sub">≈ ฿${Math.round(summary.total_retail_thb || 0).toLocaleString()}</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">มูลค่ารับซื้อคืน Buylist ($)</div>
                            <div class="print-kpi-val" style="color: #b45309;">$${(summary.total_buy_usd || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                            <div class="print-kpi-sub">≈ ฿${Math.round(summary.total_buy_thb || 0).toLocaleString()}</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">จำนวนการ์ดในพอร์ต</div>
                            <div class="print-kpi-val">${summary.total_count || 0}</div>
                            <div class="print-kpi-sub">${summary.total_unique || 0} ชนิดที่ถือครอง</div>
                        </div>
                        <div class="print-kpi-box">
                            <div class="print-kpi-label">เงินสดขายการ์ดไปแล้ว</div>
                            <div class="print-kpi-val" style="color: #059669;">฿${Math.round(summary.total_sold_thb || 0).toLocaleString()}</div>
                            <div class="print-kpi-sub">ขายแล้ว ${summary.total_sold_count || 0} ใบ</div>
                        </div>
                    </div>
                    
                    <table class="print-table">
                        <thead>
                            <tr>
                                <th style="width: 35px;">#</th>
                                <th>ชื่อการ์ด</th>
                                <th>รอบเปิด</th>
                                <th>ชุด</th>
                                <th>ความหายาก</th>
                                <th>รูปแบบ</th>
                                <th class="text-center">จำนวน</th>
                                <th class="text-right">CKD Retail ($)</th>
                                <th class="text-right">ราคาต่อใบ (บาท)</th>
                                <th class="text-right">มูลค่ารวม (บาท)</th>
                                <th class="text-right">CKD Buylist ($)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cards.map((c, idx) => {
                                const thbUnit = c.price_retail * thbRate;
                                const thbTotal = thbUnit * c.qty;
                                return `
                                <tr>
                                    <td>${idx + 1}</td>
                                    <td style="font-weight: 600;">${c.name}</td>
                                    <td>${c.box_name || 'รอบที่ 1'}</td>
                                    <td>${c.set_code.toUpperCase()} #${c.collector_number}</td>
                                    <td style="text-transform: capitalize;">${c.rarity || '-'}</td>
                                    <td>${c.is_foil ? '<span class="print-badge-foil">★ Foil</span>' : 'Regular'}</td>
                                    <td class="text-center" style="font-weight: 700;">${c.qty}</td>
                                    <td class="text-right" style="font-weight: 700;">$${c.price_retail.toFixed(2)}</td>
                                    <td class="text-right">฿${Math.round(thbUnit).toLocaleString()}</td>
                                    <td class="text-right" style="font-weight: 700; color: #059669;">฿${Math.round(thbTotal).toLocaleString()}</td>
                                    <td class="text-right" style="color: #b45309;">$${c.price_buy.toFixed(2)}</td>
                                </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                    
                    <div class="print-footer-notes">
                        <div>* ราคาอ้างอิงจาก Card Kingdom API v2 ซิงค์แบบเรียลไทม์</div>
                        <div>Generated by MTG Card Kingdom Realtime Tracker</div>
                    </div>
                </div>
            `;
        }
        
        area.innerHTML = html;
    } catch (e) {
        console.error('Error generating printable report', e);
        area.innerHTML = '<div style="color: #ef4444; padding: 2rem; text-align: center;"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><p style="margin-top: 0.5rem;">เกิดข้อผิดพลาดในการโหลดข้อมูลสำหรับสร้างรายงาน</p></div>';
    }
}

function printReportSheet() {
    window.print();
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    loadBoxes();
    loadCards();
    
    // Auto-refresh cards every 60 seconds
    setInterval(() => {
        loadBoxes();
        loadCards();
    }, 60000);
    
    // Search input
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('btnClearSearch');
    searchInput.addEventListener('input', () => {
        clearBtn.style.display = searchInput.value ? 'block' : 'none';
        loadCards();
    });
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.style.display = 'none';
        loadCards();
    });
    
    // Filters & Sorting
    document.getElementById('filterRarity').addEventListener('change', loadCards);
    document.getElementById('filterFoil').addEventListener('change', loadCards);
    document.getElementById('selectSort').addEventListener('change', loadCards);
    
    // Currency select in Sell Modal
    const selectSellCurrency = document.getElementById('selectSellCurrency');
    if (selectSellCurrency) {
        selectSellCurrency.addEventListener('change', (e) => {
            const sym = e.target.value === 'THB' ? '฿' : '$';
            document.getElementById('sellCurrencySymbol').textContent = sym;
            const priceInput = document.getElementById('inputSellPrice');
            if (currentSellCard) {
                if (e.target.value === 'THB') {
                    const mult = parseFloat(document.getElementById('inputSellRateMultiplier')?.value) || currentSellMultiplier || 25.0;
                    priceInput.value = (Math.round(currentSellCard.price_retail * mult * 100) / 100).toFixed(2);
                } else {
                    priceInput.value = currentSellCard.price_retail.toFixed(2);
                }
            }
        });
    }

    // Rate Multiplier input change
    const multInput = document.getElementById('inputSellRateMultiplier');
    if (multInput) {
        multInput.addEventListener('input', onSellMultiplierInputChange);
    }

    // Two-way calculation when manually editing price in THB
    const priceInput = document.getElementById('inputSellPrice');
    if (priceInput) {
        priceInput.addEventListener('input', () => {
            const curr = document.getElementById('selectSellCurrency').value;
            if (curr === 'THB' && currentSellCard && currentSellCard.price_retail > 0) {
                const val = parseFloat(priceInput.value);
                if (!isNaN(val) && val > 0) {
                    const derivedRate = Math.round((val / currentSellCard.price_retail) * 10) / 10;
                    const multEl = document.getElementById('inputSellRateMultiplier');
                    if (multEl) multEl.value = derivedRate;
                    currentSellMultiplier = derivedRate;
                    updateRateMultiplierFormula();
                    document.querySelectorAll('.rate-chip').forEach(ch => {
                        ch.classList.toggle('active', parseFloat(ch.getAttribute('data-rate')) === derivedRate);
                    });
                }
            }
        });
    }

    // Alerts Filter
    const btnFilterAlerts = document.getElementById('btnFilterAlerts');
    btnFilterAlerts.addEventListener('click', () => {
        filterAlertsOnly = !filterAlertsOnly;
        btnFilterAlerts.classList.toggle('active', filterAlertsOnly);
        renderCardsUI();
    });
    
    // Display Scale Switcher Buttons
    document.querySelectorAll('.scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.getAttribute('data-scale-val');
            if (val) {
                applyDisplayScale(val, true);
                const labels = {
                    'macbook': '💻 ปรับสเกลเป็น MacBook Air M3 (85%) เรียบร้อย',
                    'compact': '📱 ปรับสเกลเป็น กะทัดรัดพิเศษ (75%) เรียบร้อย',
                    'normal': '🖥️ ปรับสเกลเป็น หน้าจอใหญ่ปกติ (100%) เรียบร้อย'
                };
                showToast(labels[val] || 'ปรับขนาดสเกลเรียบร้อย', 'info');
            }
        });
    });

    const selectScale = document.getElementById('selectDisplayScale');
    if (selectScale) {
        selectScale.addEventListener('change', (e) => {
            applyDisplayScale(e.target.value, true);
        });
    }

    // View Switcher
    const btnViewGrid = document.getElementById('btnViewGrid');
    const btnViewTable = document.getElementById('btnViewTable');
    btnViewGrid.addEventListener('click', () => {
        currentView = 'grid';
        btnViewGrid.classList.add('active');
        btnViewTable.classList.remove('active');
        renderCardsUI();
    });
    btnViewTable.addEventListener('click', () => {
        currentView = 'table';
        btnViewTable.classList.add('active');
        btnViewGrid.classList.remove('active');
        renderCardsUI();
    });
    
    // Buttons
    document.getElementById('btnSyncNow').addEventListener('click', syncPricesNow);
    document.getElementById('btnOpenAddModal').addEventListener('click', () => openModal('addCardsModal'));
    document.getElementById('btnOpenAlerts').addEventListener('click', openAlertsModal);
    document.getElementById('btnOpenSales').addEventListener('click', openSalesModal);
    const btnExportModal = document.getElementById('btnOpenExportModal');
    if (btnExportModal) btnExportModal.addEventListener('click', openExportModal);
    document.getElementById('btnOpenSettings').addEventListener('click', () => openModal('settingsModal'));
    document.getElementById('btnMarkAlertsRead').addEventListener('click', markAlertsRead);
    document.getElementById('btnSimulateAlert').addEventListener('click', simulatePriceAlert);
    document.getElementById('btnSubmitImport').addEventListener('click', submitImport);
    document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
    
    // Box Cost Buttons & Select
    const btnBoxModal = document.getElementById('btnOpenBoxCostModal');
    if (btnBoxModal) btnBoxModal.addEventListener('click', () => openBoxCostModal(selectedBoxId));
    const btnEditBox = document.getElementById('btnEditBoxCost');
    if (btnEditBox) btnEditBox.addEventListener('click', () => openBoxCostModal(selectedBoxId));
    
    // Close modal on backdrop click
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(modal.id);
            }
        });
    });
});
