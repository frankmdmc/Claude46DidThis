// === script.js — Single-Game EV Calculator ===

(function () {
  'use strict';

  // --- DOM refs ---
  const urlInput = document.getElementById('game-url');
  const fetchBtn = document.getElementById('fetch-btn');
  const calcBtn = document.getElementById('calc-btn');
  const addTierBtn = document.getElementById('add-tier-btn');
  const tierContainer = document.getElementById('tier-container');
  const resultsSection = document.getElementById('results-section');
  const errorSection = document.getElementById('error-section');
  const errorMessage = document.getElementById('error-message');
  const metadataDiv = document.getElementById('metadata');
  const evResultDiv = document.getElementById('ev-result');
  const prizeTableBody = document.getElementById('prize-table-body');
  const mathExampleDiv = document.getElementById('math-example');
  const ignoreUnder500 = document.getElementById('ignore-under-500');
  const applyTax = document.getElementById('apply-tax');
  const taxRateInput = document.getElementById('tax-rate');
  const gameNameInput = document.getElementById('game-name');
  const gameNumberInput = document.getElementById('game-number');
  const ticketPriceInput = document.getElementById('ticket-price');
  const claimedOddsInput = document.getElementById('claimed-odds');
  const claimedCashOddsInput = document.getElementById('claimed-cash-odds');

  // --- CORS proxy ---
  const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

  // --- Tier management ---
  let tierCount = 0;

  function createTierRow(data) {
    const idx = tierCount++;
    const row = document.createElement('div');
    row.className = 'tier-row';
    row.dataset.tierIdx = idx;
    row.innerHTML = `
      <div class="input-group">
        <label>Prize</label>
        <input type="text" class="tier-prize" placeholder="$1,000 or Ticket" value="${data ? data.prize : ''}" />
      </div>
      <div class="input-group">
        <label>Odds (1 in N)</label>
        <input type="text" class="tier-odds" placeholder="e.g. 4.25" value="${data ? data.odds : ''}" />
      </div>
      <div class="input-group">
        <label>Remaining</label>
        <input type="number" class="tier-remaining" placeholder="0" min="0" value="${data ? data.remaining : ''}" />
      </div>
      <div class="input-group">
        <label>Total</label>
        <input type="number" class="tier-total" placeholder="0" min="0" value="${data ? data.total : ''}" />
      </div>
      <button class="btn btn-danger" onclick="this.parentElement.remove()">X</button>
    `;
    tierContainer.appendChild(row);
    return row;
  }

  addTierBtn.addEventListener('click', () => createTierRow());

  // Seed 3 empty rows
  for (let i = 0; i < 3; i++) createTierRow();

  // --- Parsing helpers ---

  function parseCurrency(str) {
    if (typeof str === 'number') return str;
    if (!str) return NaN;
    const cleaned = String(str).replace(/[$,\s]/g, '');
    return parseFloat(cleaned);
  }

  function parseOdds(str) {
    if (typeof str === 'number') return str;
    if (!str) return NaN;
    const s = String(str).trim();
    // Match "1 in N" or just "N"
    const m = s.match(/1\s+in\s+([\d,.]+)/i);
    if (m) return parseCurrency(m[1]);
    return parseCurrency(s);
  }

  function parseRemainingOfTotal(str) {
    // "X of Y" pattern
    const m = String(str).trim().match(/([\d,]+)\s+of\s+([\d,]+)/i);
    if (m) {
      return {
        remaining: parseInt(m[1].replace(/,/g, ''), 10),
        total: parseInt(m[2].replace(/,/g, ''), 10),
      };
    }
    return null;
  }

  function isTicketTier(prizeLabel) {
    const s = String(prizeLabel).trim().toLowerCase();
    return s === 'ticket' || s === 'free ticket' || s.includes('free ticket');
  }

  // --- HTML parsing for CA Lottery pages ---

  function parseCalotteryHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const game = {
      name: '',
      number: '',
      ticketPrice: 0,
      claimedOdds: '',
      claimedCashOdds: '',
      tiers: [],
    };

    // Title — e.g. "$pring Green (1710)"
    const titleEl = doc.querySelector('h1') || doc.querySelector('title');
    if (titleEl) {
      const t = titleEl.textContent.trim();
      game.name = t;
      const numMatch = t.match(/\((\d+)\)/);
      if (numMatch) {
        game.number = numMatch[1];
        game.name = t.replace(/\s*\(\d+\)/, '').trim();
      }
    }

    // Try to extract ticket price from URL path or page content
    const priceMatch = html.match(/\$(\d+)\s*(?:scratchers|scratcher|ticket)/i) ||
      html.match(/Price[:\s]*\$(\d+)/i);
    if (priceMatch) {
      game.ticketPrice = parseInt(priceMatch[1], 10);
    }

    // Overall and cash odds from page text
    const oddsPatterns = html.match(/(?:Overall\s+)?[Oo]dds[:\s]*1\s+in\s+([\d,.]+)/g);
    if (oddsPatterns) {
      game.claimedOdds = oddsPatterns[0];
      if (oddsPatterns.length > 1) {
        game.claimedCashOdds = oddsPatterns[1];
      }
    }

    // Prize table: look for table rows containing prize data
    // The CA Lottery page has tables with: Prize | Odds 1 in | Prizes Remaining (X of Y)
    const tables = doc.querySelectorAll('table');
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const prizeText = cells[0].textContent.trim();
          const oddsText = cells[1].textContent.trim();
          const remainingText = cells[2].textContent.trim();

          const parsedRemaining = parseRemainingOfTotal(remainingText);
          const oddsVal = parseOdds(oddsText);
          const prizeVal = parseCurrency(prizeText);

          if (parsedRemaining && !isNaN(oddsVal)) {
            game.tiers.push({
              prize: prizeText,
              value: isTicketTier(prizeText) ? NaN : prizeVal, // NaN sentinel for ticket tier
              isTicket: isTicketTier(prizeText),
              odds: oddsVal,
              remaining: parsedRemaining.remaining,
              total: parsedRemaining.total,
            });
          }
        }
      }
    }

    // If no table found, try parsing from raw text patterns
    if (game.tiers.length === 0) {
      const textContent = doc.body ? doc.body.textContent : html;
      // Look for repeated patterns like "$X,XXX | 1 in Y | Z of W" or similar
      const tierRegex = /(\$[\d,]+|Ticket)\s*[|\t]+\s*(?:1\s+in\s+)?([\d,]+(?:\.\d+)?)\s*[|\t]+\s*([\d,]+)\s+of\s+([\d,]+)/gi;
      let match;
      while ((match = tierRegex.exec(textContent)) !== null) {
        const prizeText = match[1];
        const oddsVal = parseCurrency(match[2]);
        const remaining = parseInt(match[3].replace(/,/g, ''), 10);
        const total = parseInt(match[4].replace(/,/g, ''), 10);
        game.tiers.push({
          prize: prizeText,
          value: isTicketTier(prizeText) ? NaN : parseCurrency(prizeText),
          isTicket: isTicketTier(prizeText),
          odds: oddsVal,
          remaining,
          total,
        });
      }
    }

    return game;
  }

  // --- Fetch game data from URL ---

  async function fetchGameData(url) {
    // Extract ticket price from URL path: /scratchers/$20/... -> 20
    const urlPriceMatch = url.match(/\/scratchers\/\$(\d+)\//i);
    let urlPrice = urlPriceMatch ? parseInt(urlPriceMatch[1], 10) : 0;

    const proxied = CORS_PROXY + encodeURIComponent(url);
    const resp = await fetch(proxied);
    if (!resp.ok) throw new Error(`Failed to fetch page (HTTP ${resp.status})`);
    const html = await resp.text();

    const game = parseCalotteryHtml(html);
    if (urlPrice && !game.ticketPrice) {
      game.ticketPrice = urlPrice;
    }
    return game;
  }

  // --- Collect manual input ---

  function collectManualInput() {
    const game = {
      name: gameNameInput.value.trim(),
      number: gameNumberInput.value.trim(),
      ticketPrice: parseFloat(ticketPriceInput.value) || 0,
      claimedOdds: claimedOddsInput.value.trim(),
      claimedCashOdds: claimedCashOddsInput.value.trim(),
      tiers: [],
    };

    const rows = tierContainer.querySelectorAll('.tier-row');
    for (const row of rows) {
      const prizeText = row.querySelector('.tier-prize').value.trim();
      const oddsText = row.querySelector('.tier-odds').value.trim();
      const remaining = parseInt(row.querySelector('.tier-remaining').value, 10);
      const total = parseInt(row.querySelector('.tier-total').value, 10);

      if (!prizeText || isNaN(remaining)) continue;

      game.tiers.push({
        prize: prizeText,
        value: isTicketTier(prizeText) ? NaN : parseCurrency(prizeText),
        isTicket: isTicketTier(prizeText),
        odds: parseOdds(oddsText),
        remaining,
        total: isNaN(total) ? remaining : total,
      });
    }

    return game;
  }

  // --- EV computation engine ---

  function computeEV(game, options) {
    const { ignoreUnder500: ignore500, applyTax: doTax, taxRate } = options;
    const ticketPrice = game.ticketPrice;
    const tiers = game.tiers;

    if (!ticketPrice || tiers.length === 0) {
      return { error: 'Need ticket price and at least one prize tier.' };
    }

    // Resolve ticket-tier value
    for (const t of tiers) {
      if (t.isTicket) t.value = ticketPrice;
    }

    // --- Estimate total remaining tickets (M) ---
    // Method A: ticket-tier anchor
    let M = null;
    let method = '';
    const ticketTier = tiers.find((t) => t.isTicket && t.total > 0 && t.remaining > 0 && !isNaN(t.odds));
    if (ticketTier) {
      const M0 = ticketTier.total * ticketTier.odds;
      const f = ticketTier.remaining / ticketTier.total;
      M = M0 * f;
      method = 'Ticket-tier anchor';
    }

    // Method B fallback: median of tier-implied ticket counts
    if (!M || M <= 0) {
      const estimates = tiers
        .filter((t) => t.remaining > 0 && !isNaN(t.odds) && t.odds > 0)
        .map((t) => t.remaining * t.odds);
      if (estimates.length > 0) {
        estimates.sort((a, b) => a - b);
        const mid = Math.floor(estimates.length / 2);
        M = estimates.length % 2 === 0
          ? (estimates[mid - 1] + estimates[mid]) / 2
          : estimates[mid];
        method = 'Median fallback';
      }
    }

    if (!M || M <= 0) {
      return { error: 'Unable to estimate total remaining tickets.' };
    }

    // Compute per-tier data
    const tierResults = [];
    let evGross = 0;

    for (const t of tiers) {
      const p = t.remaining / M;
      let adjusted = t.value;

      // Ignore under $500
      if (ignore500 && !t.isTicket && adjusted > 0 && adjusted < 500) {
        adjusted = 0;
      }

      // Apply tax to monetary prizes
      if (doTax && !t.isTicket && adjusted > 0) {
        adjusted = adjusted * (1 - taxRate / 100);
      }

      const contribution = p * adjusted;
      evGross += contribution;

      tierResults.push({
        prize: t.prize,
        value: t.value,
        oddsText: t.odds ? `1 in ${formatNum(t.odds)}` : '—',
        remaining: t.remaining,
        total: t.total,
        parsedN: t.odds,
        tierTicketEst: t.remaining * (t.odds || 0),
        probability: p,
        adjustedValue: adjusted,
        evContribution: contribution,
        isTicket: t.isTicket,
      });
    }

    const evNet = evGross - ticketPrice;

    return {
      ticketPrice,
      M,
      method,
      evGross,
      evNet,
      tiers: tierResults,
    };
  }

  // --- Formatting helpers ---

  function formatNum(n, decimals) {
    if (typeof decimals === 'number') return n.toFixed(decimals);
    if (Number.isInteger(n)) return n.toLocaleString();
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function formatMoney(n, decimals) {
    const d = typeof decimals === 'number' ? decimals : 2;
    return '$' + Math.abs(n).toFixed(d);
  }

  function formatPct(n) {
    return (n * 100).toFixed(6) + '%';
  }

  // --- Render results ---

  function renderResults(game, result) {
    if (result.error) {
      showError(result.error);
      return;
    }

    errorSection.style.display = 'none';
    resultsSection.style.display = '';

    // Metadata
    let metaHtml = '';
    if (game.name) metaHtml += metaItem('Game Name', game.name);
    if (game.number) metaHtml += metaItem('Game Number', game.number);
    metaHtml += metaItem('Ticket Price', formatMoney(game.ticketPrice));
    if (game.claimedOdds) metaHtml += metaItem('Claimed Overall Odds', game.claimedOdds);
    if (game.claimedCashOdds) metaHtml += metaItem('Claimed Cash Odds', game.claimedCashOdds);
    metaHtml += metaItem('Est. Remaining Tickets', formatNum(Math.round(result.M)));
    metaHtml += metaItem('Estimation Method', result.method);
    metadataDiv.innerHTML = metaHtml;

    // EV display
    const isPositive = result.evNet >= 0;
    evResultDiv.className = 'ev-result ' + (isPositive ? 'positive' : 'negative');
    evResultDiv.innerHTML = `
      <div class="ev-label">Expected Net Ticket Value</div>
      <div class="ev-value ${isPositive ? 'positive' : 'negative'}">
        ${isPositive ? '+' : '-'}${formatMoney(result.evNet, 4)}
      </div>
      <div class="ev-sub">Gross EV: ${formatMoney(result.evGross, 4)} | Ticket Cost: ${formatMoney(result.ticketPrice)}</div>
    `;

    // Prize table
    prizeTableBody.innerHTML = '';
    for (const t of result.tiers) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(t.prize)}</td>
        <td>${t.oddsText}</td>
        <td>${formatNum(t.remaining)}</td>
        <td>${formatNum(t.total)}</td>
        <td>${formatNum(t.parsedN)}</td>
        <td>${formatNum(Math.round(t.tierTicketEst))}</td>
        <td>${formatPct(t.probability)}</td>
        <td>${formatMoney(t.adjustedValue)}</td>
        <td>${t.evContribution >= 0 ? '+' : '-'}${formatMoney(t.evContribution, 4)}</td>
      `;
      prizeTableBody.appendChild(tr);
    }

    // Math example — pick a tier with meaningful contribution
    const exTier = result.tiers.find((t) => t.evContribution > 0 && !t.isTicket) || result.tiers[0];
    if (exTier) {
      mathExampleDiv.innerHTML = `
        <h4>Math Example: "${escapeHtml(exTier.prize)}" tier</h4>
        <p>
          Remaining prizes: <code>${formatNum(exTier.remaining)}</code><br>
          Estimated remaining tickets (M): <code>${formatNum(Math.round(result.M))}</code><br>
          Tier probability: <code>${formatNum(exTier.remaining)} / ${formatNum(Math.round(result.M))} = ${formatPct(exTier.probability)}</code><br>
          Adjusted prize value: <code>${formatMoney(exTier.adjustedValue)}</code><br>
          EV contribution: <code>${formatPct(exTier.probability)} &times; ${formatMoney(exTier.adjustedValue)} = ${formatMoney(exTier.evContribution, 4)}</code>
        </p>
      `;
    }
  }

  function metaItem(label, value) {
    return `<div class="meta-item"><div class="meta-label">${escapeHtml(label)}</div><div class="meta-value">${escapeHtml(String(value))}</div></div>`;
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

  function getOptions() {
    return {
      ignoreUnder500: ignoreUnder500.checked,
      applyTax: applyTax.checked,
      taxRate: parseFloat(taxRateInput.value) || 24,
    };
  }

  // --- Recalculate when options change ---

  let lastGame = null;

  function recalculate() {
    if (!lastGame) return;
    const result = computeEV(lastGame, getOptions());
    renderResults(lastGame, result);
  }

  ignoreUnder500.addEventListener('change', recalculate);
  applyTax.addEventListener('change', recalculate);
  taxRateInput.addEventListener('input', recalculate);

  // --- Fetch button ---

  fetchBtn.addEventListener('click', async () => {
    const url = urlInput.value.trim();
    if (!url) {
      showError('Please enter a scratcher game URL.');
      return;
    }

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';

    try {
      const game = await fetchGameData(url);
      if (game.tiers.length === 0) {
        showError('Could not parse any prize tiers from the page. Try manual input.');
        return;
      }

      // Populate manual fields for reference
      if (game.name) gameNameInput.value = game.name;
      if (game.number) gameNumberInput.value = game.number;
      if (game.ticketPrice) ticketPriceInput.value = game.ticketPrice;
      if (game.claimedOdds) claimedOddsInput.value = game.claimedOdds;
      if (game.claimedCashOdds) claimedCashOddsInput.value = game.claimedCashOdds;

      // Populate tier rows
      tierContainer.innerHTML = '';
      tierCount = 0;
      for (const t of game.tiers) {
        createTierRow({
          prize: t.prize,
          odds: String(t.odds),
          remaining: t.remaining,
          total: t.total,
        });
      }

      lastGame = game;
      const result = computeEV(game, getOptions());
      renderResults(game, result);
    } catch (e) {
      showError('Fetch failed: ' + e.message);
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch & Analyze';
    }
  });

  // --- Manual calc button ---

  calcBtn.addEventListener('click', () => {
    const game = collectManualInput();
    if (!game.ticketPrice) {
      showError('Please enter a ticket price.');
      return;
    }
    if (game.tiers.length === 0) {
      showError('Please add at least one prize tier with data.');
      return;
    }

    lastGame = game;
    const result = computeEV(game, getOptions());
    renderResults(game, result);
  });

  // === Expose for testing ===
  window._scratcherCalc = {
    parseCurrency,
    parseOdds,
    parseRemainingOfTotal,
    isTicketTier,
    computeEV,
    parseCalotteryHtml,
  };
})();
