// === scratchers.js — Multi-Game Overview Engine ===

(function () {
  'use strict';

  // --- DOM refs ---
  const jsonInput = document.getElementById('json-input');
  const loadJsonBtn = document.getElementById('load-json-btn');
  const loadSampleBtn = document.getElementById('load-sample-btn');
  const resultsSection = document.getElementById('results-section');
  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');
  const scratchersBody = document.getElementById('scratchers-body');
  const gameCountSpan = document.getElementById('game-count');
  const ignoreUnder500 = document.getElementById('ignore-under-500');
  const applyTax = document.getElementById('apply-tax');
  const taxRateInput = document.getElementById('tax-rate');

  // --- State ---
  let gamesData = [];
  let sortKey = 'calcEV';
  let sortDir = 1; // 1 = ascending, -1 = descending

  // --- Parsing helpers ---

  function parseCurrency(str) {
    if (typeof str === 'number') return str;
    if (!str) return NaN;
    return parseFloat(String(str).replace(/[$,\s]/g, ''));
  }

  function parseOdds(str) {
    if (typeof str === 'number') return str;
    if (!str) return NaN;
    const m = String(str).trim().match(/1\s+in\s+([\d,.]+)/i);
    if (m) return parseCurrency(m[1]);
    return parseCurrency(str);
  }

  function isTicketTier(val) {
    if (typeof val === 'string') {
      const s = val.trim().toLowerCase();
      return s === 'ticket' || s === 'free ticket' || s.includes('free ticket');
    }
    return false;
  }

  // --- Value adjustments ---

  function adjustValue(value, isTicket, options) {
    let a = value;
    if (options.ignoreUnder500 && !isTicket && a > 0 && a < 500) {
      a = 0;
    }
    if (options.applyTax && !isTicket && a > 0) {
      a = a * (1 - options.taxRate / 100);
    }
    return a;
  }

  // --- Multi-game EV engine (Section 5 of spec) ---

  function computeOverview(game, options) {
    const price = game.price;
    const tiers = game.tiers;

    if (!price || !tiers || tiers.length === 0) {
      return null;
    }

    // Resolve values
    const resolved = tiers.map((t) => {
      const label = t.label || t.prize || '';
      const isTkt = isTicketTier(label) || t.isTicket;
      const rawValue = isTkt ? price : parseCurrency(t.value);
      const odds = typeof t.odds === 'number' ? t.odds : parseOdds(t.odds);
      const remaining = t.remaining || 0;
      const total = t.total || t.initial || remaining;
      return { label, rawValue, odds, remaining, total, isTicket: isTkt };
    });

    // Filter tiers with valid data
    const valid = resolved.filter((t) => t.total > 0 && !isNaN(t.odds) && t.odds > 0);
    if (valid.length === 0) return null;

    // 5.1 Ticket Count and Remaining Pool
    // Q_i = odds_i * total_i
    const Qs = valid.map((t) => t.odds * t.total);
    const M0 = Qs.reduce((a, b) => a + b, 0) / Qs.length; // mean

    const Tsum = valid.reduce((s, t) => s + t.total, 0);
    const Rsum = valid.reduce((s, t) => s + t.remaining, 0);

    if (Tsum === 0 || Rsum === 0 || M0 === 0) return null;

    const Mhat = M0 * (Rsum / Tsum);
    const calcOddsVal = Mhat / Rsum;

    // 5.2 Claimed vs Calculated EV

    // Claimed (launch-state) gross EV
    let claimedGross = 0;
    for (const t of valid) {
      const adj = adjustValue(t.rawValue, t.isTicket, options);
      claimedGross += adj * t.total;
    }
    claimedGross = claimedGross / M0;
    const claimedNet = claimedGross - price;

    // Calculated (current-state) gross EV
    let calcGross = 0;
    for (const t of valid) {
      const adj = adjustValue(t.rawValue, t.isTicket, options);
      calcGross += adj * t.remaining;
    }
    calcGross = calcGross / Mhat;
    const calcNet = calcGross - price;

    // EV delta %
    const deltaPercent = claimedNet !== 0
      ? ((calcNet - claimedNet) / Math.abs(claimedNet)) * 100
      : 0;

    return {
      name: game.name,
      number: game.number || '',
      price,
      claimedOddsText: game.claimedOdds || '—',
      claimedOddsVal: parseOdds(game.claimedOdds),
      calcOddsVal,
      claimedEV: claimedNet,
      calcEV: calcNet,
      deltaPercent,
    };
  }

  // --- Rendering ---

  function getOptions() {
    return {
      ignoreUnder500: ignoreUnder500.checked,
      applyTax: applyTax.checked,
      taxRate: parseFloat(taxRateInput.value) || 24,
    };
  }

  function formatMoney(n) {
    const sign = n >= 0 ? '+' : '-';
    return sign + '$' + Math.abs(n).toFixed(4);
  }

  function formatOdds(n) {
    if (!n || isNaN(n)) return '—';
    return '1 in ' + n.toFixed(2);
  }

  function renderTable() {
    const options = getOptions();
    const results = gamesData
      .map((g) => computeOverview(g, options))
      .filter(Boolean);

    // Sort
    results.sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    });

    gameCountSpan.textContent = `(${results.length} games)`;
    scratchersBody.innerHTML = '';

    for (const r of results) {
      const tr = document.createElement('tr');

      // Delta badge
      let badgeClass = 'badge-neutral';
      let badgePrefix = '';
      if (r.deltaPercent > 1) { badgeClass = 'badge-positive'; badgePrefix = '+'; }
      else if (r.deltaPercent < -1) { badgeClass = 'badge-negative'; badgePrefix = ''; }

      // EV coloring
      const claimedClass = r.claimedEV >= 0 ? 'positive' : 'negative';
      const calcClass = r.calcEV >= 0 ? 'positive' : 'negative';

      tr.innerHTML = `
        <td>$${r.price}</td>
        <td><a class="game-link" href="index.html">${escapeHtml(r.name)}</a></td>
        <td>${escapeHtml(r.number)}</td>
        <td>${escapeHtml(r.claimedOddsText)}</td>
        <td>${formatOdds(r.calcOddsVal)}</td>
        <td class="ev-value ${claimedClass}" style="font-size:inherit;font-weight:600">${formatMoney(r.claimedEV)}</td>
        <td class="ev-value ${calcClass}" style="font-size:inherit;font-weight:600">${formatMoney(r.calcEV)}</td>
        <td><span class="badge ${badgeClass}">${badgePrefix}${r.deltaPercent.toFixed(1)}%</span></td>
      `;
      scratchersBody.appendChild(tr);
    }

    resultsSection.style.display = '';
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function showError(msg) {
    resultsSection.style.display = 'none';
    errorSection.style.display = '';
    errorMessage.textContent = msg;
  }

  // --- Sort handlers ---

  document.querySelectorAll('.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (sortKey === key) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = key === 'name' || key === 'number' ? 1 : -1; // default desc for numbers
      }
      // Update arrows
      document.querySelectorAll('.sort-arrow').forEach((el) => (el.textContent = ''));
      th.querySelector('.sort-arrow').textContent = sortDir === 1 ? '\u25B2' : '\u25BC';
      if (gamesData.length > 0) renderTable();
    });
  });

  // --- Option change handlers ---

  ignoreUnder500.addEventListener('change', () => { if (gamesData.length > 0) renderTable(); });
  applyTax.addEventListener('change', () => { if (gamesData.length > 0) renderTable(); });
  taxRateInput.addEventListener('input', () => { if (gamesData.length > 0) renderTable(); });

  // --- Load JSON ---

  loadJsonBtn.addEventListener('click', () => {
    const raw = jsonInput.value.trim();
    if (!raw) {
      showError('Please paste game data JSON.');
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      gamesData = Array.isArray(parsed) ? parsed : [parsed];
      errorSection.style.display = 'none';
      renderTable();
    } catch (e) {
      showError('Invalid JSON: ' + e.message);
    }
  });

  // --- Sample data ---

  const SAMPLE_DATA = [
    {
      name: '$pring Green',
      number: '1710',
      price: 2,
      claimedOdds: '1 in 4.25',
      tiers: [
        { value: 20000, odds: 610120, remaining: 15, total: 15 },
        { value: 1000, odds: 62257, remaining: 137, total: 147 },
        { value: 200, odds: 11994, remaining: 659, total: 763 },
        { value: 100, odds: 1688, remaining: 4693, total: 5421 },
        { value: 40, odds: 413, remaining: 19173, total: 22154 },
        { value: 20, odds: 100, remaining: 79606, total: 91518 },
        { value: 10, odds: 42, remaining: 191432, total: 219458 },
        { value: 5, odds: 26, remaining: 304279, total: 347398 },
        { value: 4, odds: 12, remaining: 644835, total: 733070 },
        { label: 'Ticket', value: 'Ticket', isTicket: true, odds: 12, remaining: 646383, total: 732144 },
      ],
    },
    {
      name: 'Cash Crush',
      number: '1712',
      price: 5,
      claimedOdds: '1 in 4.53',
      tiers: [
        { value: 250000, odds: 1219589, remaining: 14, total: 14 },
        { value: 10000, odds: 588767, remaining: 29, total: 29 },
        { value: 1000, odds: 12058, remaining: 1325, total: 1416 },
        { value: 500, odds: 2607, remaining: 5796, total: 6550 },
        { value: 100, odds: 400, remaining: 38033, total: 42729 },
        { value: 50, odds: 200, remaining: 76005, total: 85381 },
        { value: 30, odds: 150, remaining: 101585, total: 113808 },
        { value: 20, odds: 40, remaining: 380672, total: 426856 },
        { value: 15, odds: 27, remaining: 572770, total: 640358 },
        { value: 10, odds: 15, remaining: 1051762, total: 1173743 },
        { value: 6, odds: 13, remaining: 1152384, total: 1280568 },
      ],
    },
    {
      name: 'Fireball Bingo',
      number: '1711',
      price: 3,
      claimedOdds: '1 in 3.61',
      tiers: [
        { value: 20000, odds: 798080, remaining: 10, total: 10 },
        { value: 1000, odds: 79808, remaining: 88, total: 100 },
        { value: 500, odds: 15962, remaining: 420, total: 500 },
        { value: 200, odds: 7981, remaining: 840, total: 1000 },
        { value: 100, odds: 2661, remaining: 2517, total: 3000 },
        { value: 50, odds: 1330, remaining: 5031, total: 5994 },
        { value: 30, odds: 266, remaining: 25159, total: 29970 },
        { value: 20, odds: 89, remaining: 75370, total: 89910 },
        { value: 10, odds: 22, remaining: 301650, total: 359641 },
        { value: 6, odds: 17, remaining: 401502, total: 469930 },
        { label: 'Ticket', value: 'Ticket', isTicket: true, odds: 8, remaining: 832098, total: 998504 },
      ],
    },
    {
      name: '$1,000,000 Money Mania',
      number: '1713',
      price: 10,
      claimedOdds: '1 in 3.42',
      tiers: [
        { value: 1000000, odds: 4263696, remaining: 3, total: 3 },
        { value: 30000, odds: 1421232, remaining: 9, total: 9 },
        { value: 10000, odds: 639554, remaining: 19, total: 20 },
        { value: 1000, odds: 15540, remaining: 756, total: 823 },
        { value: 500, odds: 3563, remaining: 3120, total: 3590 },
        { value: 200, odds: 1425, remaining: 7803, total: 8975 },
        { value: 100, odds: 238, remaining: 46732, total: 53850 },
        { value: 50, odds: 68, remaining: 163840, total: 188476 },
        { value: 30, odds: 34, remaining: 328165, total: 376951 },
        { value: 20, odds: 17, remaining: 658410, total: 753903 },
        { value: 15, odds: 10, remaining: 1121250, total: 1281133 },
        { label: 'Ticket', value: 'Ticket', isTicket: true, odds: 15, remaining: 745212, total: 854088 },
      ],
    },
    {
      name: 'Red Carpet Riches',
      number: '1714',
      price: 20,
      claimedOdds: '1 in 3.27',
      tiers: [
        { value: 5000000, odds: 3648260, remaining: 3, total: 3 },
        { value: 100000, odds: 1216087, remaining: 8, total: 9 },
        { value: 10000, odds: 608043, remaining: 16, total: 18 },
        { value: 2000, odds: 18426, remaining: 490, total: 594 },
        { value: 1000, odds: 8122, remaining: 1112, total: 1348 },
        { value: 500, odds: 4870, remaining: 1856, total: 2247 },
        { value: 200, odds: 730, remaining: 12366, total: 14982 },
        { value: 100, odds: 183, remaining: 49396, total: 59928 },
        { value: 50, odds: 37, remaining: 249012, total: 299640 },
        { value: 40, odds: 18, remaining: 504590, total: 611244 },
        { value: 30, odds: 11, remaining: 810612, total: 984984 },
        { label: 'Ticket', value: 'Ticket', isTicket: true, odds: 15, remaining: 607128, total: 729996 },
      ],
    },
  ];

  loadSampleBtn.addEventListener('click', () => {
    jsonInput.value = JSON.stringify(SAMPLE_DATA, null, 2);
    gamesData = SAMPLE_DATA;
    errorSection.style.display = 'none';
    renderTable();
  });
})();
