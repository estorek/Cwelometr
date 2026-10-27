'use strict';

// Tryb admina: otwórz stronę z ?admin=1 (to wygoda, nie zabezpieczenie – patrz README).
const isAdmin = new URLSearchParams(location.search).has('admin');
const DB = (typeof SUPABASE_URL === 'string' && /^https:\/\//.test(SUPABASE_URL) && typeof SUPABASE_KEY === 'string' && SUPABASE_KEY)
    ? { url: SUPABASE_URL.replace(/\/$/, ''), key: SUPABASE_KEY } : null;
const AUTO = DB && typeof AUTO_APPROVE !== 'undefined' && AUTO_APPROVE === true; // musi pasować do reguł w bazie
const canEdit = isAdmin && !DB; // przy włączonej bazie moderacja odbywa się w panelu Supabase
const COOLDOWN_KEY = 'demagog_trio_last_submit';
const dbFetch = (path, opts = {}) => fetch(`${DB.url}/rest/v1/${path}`, {
    ...opts, headers: { apikey: DB.key, 'Content-Type': 'application/json', ...opts.headers }
});
const DRAFT_KEY = 'demagog_trio_draft_v1';
const LIKES_KEY = 'demagog_trio_likes_v1';
const PEOPLE = ['Kacper', 'Łukasz', 'Damian'];
const CATEGORIES = ['Gry', 'Życie'];
const WEIGHTS = { 'PRAWDA': 1, 'PÓŁPRAWDA': 0.5 };
const STAT_IDS = { 'PRAWDA': 'Prawda', 'PÓŁPRAWDA': 'Polprawda', 'MANIPULACJA': 'Manipulacja', 'FAŁSZ': 'Falsz', 'FAŁSZ OSTATECZNY': 'FalszOstateczny' };
const PROFILE_IDS = { 'Kacper': 'kacper', 'Łukasz': 'lukasz', 'Damian': 'damian' };

const RATING_CONFIG = {
    'PRAWDA': { colorClass: 'text-emerald-400', bgClass: 'bg-emerald-950/70 border-emerald-800/60', badgeBg: 'bg-emerald-500', icon: 'fa-circle-check' },
    'PÓŁPRAWDA': { colorClass: 'text-amber-400', bgClass: 'bg-amber-950/70 border-amber-800/60', badgeBg: 'bg-amber-500', icon: 'fa-circle-half-stroke' },
    'MANIPULACJA': { colorClass: 'text-purple-400', bgClass: 'bg-purple-950/70 border-purple-800/60', badgeBg: 'bg-purple-500', icon: 'fa-mask' },
    'FAŁSZ': { colorClass: 'text-red-400', bgClass: 'bg-red-950/70 border-red-800/60', badgeBg: 'bg-red-500', icon: 'fa-circle-xmark' },
    'FAŁSZ OSTATECZNY': { colorClass: 'text-red-500 font-black', bgClass: 'bg-red-950 border-red-900', badgeBg: 'bg-red-800', icon: 'fa-skull-crossbones' }
};
const PERSON_CONFIG = {
    'Kacper': { badgeClass: 'bg-red-950 text-red-300 border-red-800', icon: 'fa-skull text-red-400' },
    'Łukasz': { badgeClass: 'bg-purple-950 text-purple-300 border-purple-800', icon: 'fa-ghost text-purple-400' },
    'Damian': { badgeClass: 'bg-emerald-950 text-emerald-300 border-emerald-800', icon: 'fa-bolt text-emerald-400' }
};

let quotes = [];
let liked = new Set();
let selectedPerson = 'ALL', verdictFilter = 'ALL', catFilter = 'ALL', searchQuery = '', currentSort = 'newest';

const $ = id => document.getElementById(id);
const on = (id, ev, fn) => $(id)?.addEventListener(ev, fn);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const today = () => new Date().toLocaleDateString('sv-SE'); // lokalna data YYYY-MM-DD
const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* brak dostępu do storage */ } }
};

// ---------- Walidacja danych (quotes.json, szkic, import) ----------
function clean(list) {
    const ok = []; let bad = 0;
    list.forEach(q => {
        const valid = q && typeof q === 'object' && PEOPLE.includes(q.person) && RATING_CONFIG[q.rating]
            && ['quote', 'context', 'reason'].every(k => typeof q[k] === 'string' && q[k].trim())
            && /^\d{4}-\d{2}-\d{2}$/.test(q.date);
        if (!valid) { bad++; return; }
        ok.push({
            id: 0, _id: q.id, person: q.person, category: CATEGORIES.includes(q.category) ? q.category : 'Gry',
            quote: q.quote.trim(), context: q.context.trim(), rating: q.rating, date: q.date, reason: q.reason.trim(),
            likes: Number.isFinite(q.likes) && q.likes > 0 ? Math.floor(q.likes) : 0
        });
    });
    const ids = new Set();
    ok.forEach(q => {
        if (Number.isInteger(q._id) && q._id > 0 && !ids.has(q._id)) { q.id = q._id; ids.add(q.id); }
        delete q._id;
    });
    let next = Math.max(0, ...ids) + 1;
    ok.forEach(q => { if (!q.id) q.id = next++; });
    return { ok, bad };
}
const nextId = () => Math.max(0, ...quotes.map(q => q.id)) + 1;

async function loadQuotes() {
    let published = [];
    try {
        const r = DB ? await dbFetch('quotes?select=*&approved=eq.true&order=date.desc')
                     : await fetch('quotes.json', { cache: 'no-cache' });
        if (r.ok) { const d = await r.json(); if (Array.isArray(d)) published = clean(d).ok; }
        else if (DB) showToast('Błąd bazy', `Supabase zwróciło kod ${r.status}.`);
    } catch {
        showToast(DB ? 'Brak połączenia z bazą' : 'Brak quotes.json',
                  location.protocol === 'file:' ? 'Otwórz stronę przez serwer (GitHub Pages lub python -m http.server).' : 'Spróbuj odświeżyć stronę.');
    }
    const draft = canEdit ? store.get(DRAFT_KEY) : null;
    quotes = Array.isArray(draft) ? clean(draft).ok : published;
    liked = new Set((store.get(LIKES_KEY) || []).filter(Number.isInteger));
}
function persist() {
    if (!store.set(DRAFT_KEY, quotes)) showToast('Błąd zapisu', 'Przeglądarka blokuje localStorage – zmiany nie zostaną zapamiętane.');
}
const refresh = () => { calculateStats(); renderCards(); };
const likeCount = q => (q.likes || 0) + (!DB && liked.has(q.id) ? 1 : 0);

// ---------- Statystyki ----------
function calculateStats() {
    PEOPLE.forEach(p => {
        const list = quotes.filter(q => q.person === p), k = PROFILE_IDS[p];
        const score = list.reduce((s, q) => s + (WEIGHTS[q.rating] || 0), 0);
        const rate = list.length ? Math.round(score / list.length * 100) : null;
        $(k + 'TruthRate').textContent = rate === null ? '—' : rate + '%';
        $(k + 'TruthBar').style.width = (rate || 0) + '%';
        $(k + 'QuoteCount').textContent = list.length;
    });

    const scoped = selectedPerson === 'ALL' ? quotes : quotes.filter(q => q.person === selectedPerson);
    const total = scoped.length;
    $('totalCount').textContent = total;
    $('statsScopeName').textContent = selectedPerson === 'ALL' ? 'Wszyscy' : selectedPerson;
    Object.entries(STAT_IDS).forEach(([rating, id]) => {
        const n = scoped.filter(q => q.rating === rating).length, pct = total ? Math.round(n / total * 100) : 0;
        $('count' + id).textContent = n;
        $('pct' + id).textContent = pct + '%';
        $('bar' + id).style.width = pct + '%';
    });

    // Cytat dnia: stabilny w ciągu doby, zależny od lokalnej daty
    const badge = $('qotdBadge');
    if (!total) {
        $('qotdText').textContent = 'Brak cytatów w bazie.';
        $('qotdContext').textContent = 'Dodaj pierwszą wypowiedź.';
        $('qotdPersonBadge').textContent = selectedPerson === 'ALL' ? 'Trio' : selectedPerson;
        badge.classList.add('hidden');
        return;
    }
    const d = new Date(), day = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
    const q = [...scoped].sort((a, b) => a.id - b.id)[day % total];
    const conf = RATING_CONFIG[q.rating];
    $('qotdText').textContent = `„${q.quote}”`;
    $('qotdContext').textContent = `— ${q.context} (${q.date})`;
    $('qotdPersonBadge').textContent = q.person;
    badge.textContent = q.rating;
    badge.className = `px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${conf.bgClass} ${conf.colorClass}`;
}

// ---------- Renderowanie ----------
function cardHtml(q, isOpen) {
    const conf = RATING_CONFIG[q.rating], p = PERSON_CONFIG[q.person], id = q.id, isLiked = liked.has(id);
    const adminBtns = canEdit ? `
        <button data-action="edit" data-id="${id}" class="hover:text-purple-400 p-1 transition-colors" title="Edytuj" aria-label="Edytuj wypowiedź"><i class="fa-solid fa-pen text-xs"></i></button>
        <button data-action="delete" data-id="${id}" class="hover:text-red-400 p-1 transition-colors" title="Usuń" aria-label="Usuń wypowiedź"><i class="fa-solid fa-trash text-xs"></i></button>` : '';
    return `
    <div class="bg-darkCard border border-darkBorder rounded-2xl p-6 flex flex-col justify-between card-hover relative overflow-hidden">
        <div class="absolute left-0 top-0 bottom-0 w-1.5 ${conf.badgeBg}"></div>
        <div>
            <div class="flex items-start justify-between gap-2 mb-3 pl-2">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold uppercase tracking-wider ${p.badgeClass}"><i class="fa-solid ${p.icon}"></i> ${esc(q.person)}</span>
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${conf.bgClass} ${conf.colorClass}"><i class="fa-solid ${conf.icon}"></i> ${esc(q.rating)}</span>
                    <span class="text-[11px] font-bold px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">${esc(q.category)}</span>
                </div>
                <div class="flex items-center gap-1.5 text-gray-400">${adminBtns}</div>
            </div>
            <blockquote class="text-base sm:text-lg font-semibold text-white pl-3 my-3 leading-snug italic border-l-2 border-purple-700/60">„${esc(q.quote)}”</blockquote>
            <div class="flex items-center justify-between text-xs text-gray-400 pl-3 mb-4">
                <span class="flex items-center gap-1.5"><i class="fa-solid fa-location-dot text-red-500"></i> Kontekst: <strong class="text-gray-300 font-medium">${esc(q.context)}</strong></span>
                <span class="text-[11px] text-gray-400 font-mono">${esc(q.date)}</span>
            </div>
        </div>
        <div class="mt-2 pt-3 border-t border-darkBorder/80">
            <details data-id="${id}" class="group/details" ${isOpen ? 'open' : ''}>
                <summary class="cursor-pointer text-xs font-bold uppercase tracking-wider text-purple-400 hover:text-purple-300 flex items-center justify-between select-none py-1">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-magnifying-glass-chart"></i> Uzasadnienie</span>
                    <i class="fa-solid fa-chevron-down text-xs transition-transform group-open/details:rotate-180"></i>
                </summary>
                <div class="mt-2 text-xs text-gray-300 leading-relaxed bg-darkBg/60 p-3 rounded-xl border border-darkBorder/60">${esc(q.reason)}</div>
            </details>
            <div class="flex items-center justify-between mt-4 pt-2 border-t border-darkBorder/40 text-xs">
                <button data-action="like" data-id="${id}" aria-pressed="${isLiked}" class="flex items-center gap-1.5 ${isLiked ? 'text-amber-400' : 'text-gray-400'} hover:text-amber-400 transition-colors px-2.5 py-1 rounded-lg bg-darkBg border border-darkBorder">
                    <i class="fa-solid fa-shield-halved text-amber-500"></i><span>Potwierdzenia:</span><strong class="text-white">${likeCount(q)}</strong>
                </button>
                <button data-action="copy" data-id="${id}" class="text-gray-400 hover:text-white transition-colors px-2 py-1 rounded bg-darkBg border border-darkBorder flex items-center gap-1"><i class="fa-solid fa-share-nodes"></i> Kopiuj</button>
            </div>
        </div>
    </div>`;
}

function renderCards() {
    const container = $('cardsContainer'), needle = searchQuery.toLowerCase();
    const open = new Set([...container.querySelectorAll('details[open]')].map(d => d.dataset.id));
    const filtered = quotes.filter(q =>
        (selectedPerson === 'ALL' || q.person === selectedPerson) &&
        (verdictFilter === 'ALL' || q.rating === verdictFilter) &&
        (catFilter === 'ALL' || q.category === catFilter) &&
        [q.quote, q.context, q.person, q.reason].some(t => t.toLowerCase().includes(needle)));
    filtered.sort((a, b) => currentSort === 'likes' ? likeCount(b) - likeCount(a)
        : currentSort === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
    $('emptyState').classList.toggle('hidden', filtered.length > 0);
    container.innerHTML = filtered.map(q => cardHtml(q, open.has(String(q.id)))).join('');
}

// ---------- Akcje na kartach ----------
async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
}
const actions = {
    like(id) {
        const was = liked.has(id);
        was ? liked.delete(id) : liked.add(id);
        store.set(LIKES_KEY, [...liked]);
        const q = quotes.find(x => x.id === id);
        if (DB && q) {
            q.likes = Math.max(0, q.likes + (was ? -1 : 1));
            dbFetch('rpc/like_quote', { method: 'POST', body: JSON.stringify({ qid: id, delta: was ? -1 : 1 }) }).catch(() => {});
        }
        renderCards();
    },
    async copy(id) {
        const q = quotes.find(x => x.id === id);
        if (!q) return;
        const ok = await copyText(`„${q.quote}” — ${q.person}\nWerdykt: ${q.rating}`);
        showToast(ok ? 'Skopiowano!' : 'Nie udało się skopiować', ok ? 'Cytat jest w schowku.' : 'Zaznacz tekst i skopiuj ręcznie.');
    },
    edit(id) {
        if (!canEdit) return;
        const q = quotes.find(x => x.id === id);
        if (!q) return;
        $('editQuoteId').value = q.id;
        $('editQuotePerson').value = q.person;
        $('editQuoteCategory').value = q.category;
        $('editQuoteText').value = q.quote;
        $('editQuoteContext').value = q.context;
        $('editQuoteRating').value = q.rating;
        $('editQuoteDate').value = q.date;
        $('editQuoteReason').value = q.reason;
        $('editModal').classList.remove('hidden');
        $('editQuoteText').focus();
    },
    delete(id) {
        if (!canEdit || !confirm('Czy na pewno chcesz usunąć ten cytat?')) return;
        quotes = quotes.filter(q => q.id !== id);
        persist(); refresh();
        showToast('Usunięto', 'Cytat został usunięty ze szkicu.');
    }
};
const closeModal = () => $('editModal').classList.add('hidden');

// ---------- UI ----------
function setActive(selector, attr, value, onCls, offCls) {
    document.querySelectorAll(selector).forEach(b => {
        const active = b.getAttribute(attr) === value;
        b.classList.remove(...(active ? offCls : onCls).split(' '));
        b.classList.add(...(active ? onCls : offCls).split(' '));
        b.setAttribute('aria-pressed', active);
    });
}
const PERSON_ON = 'bg-gradient-to-r from-red-900 via-purple-900 to-emerald-900 text-white border-purple-500 shadow-lg';
const VERDICT_ON = 'bg-gradient-to-r from-red-900 via-purple-900 to-emerald-900 text-white';
const CAT_ON = 'bg-purple-950 text-purple-200 border-purple-800';

function setPersonFilter(person) {
    selectedPerson = person;
    setActive('.person-tab-btn', 'data-person-select', person, PERSON_ON, 'bg-darkCard text-gray-400');
    refresh();
}

let toastTimer;
function showToast(title, message, ms = 3500) {
    const toast = $('toast');
    $('toastTitle').textContent = title;
    $('toastMessage').textContent = message;
    toast.classList.remove('translate-y-24', 'opacity-0');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('translate-y-24', 'opacity-0'), ms);
}

let lastEyeId = null;
function eyeSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.6);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.6);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.onended = () => ctx.close();
        osc.start(); osc.stop(t + 0.6);
    } catch { /* audio niedostępne */ }
}
function triggerEyeOfTruth() {
    const pool = selectedPerson === 'ALL' ? quotes : quotes.filter(q => q.person === selectedPerson);
    if (!pool.length) { showToast('Oko Prawdy', 'Brak cytatów do wylosowania.'); return; }
    const choices = pool.length > 1 ? pool.filter(q => q.id !== lastEyeId) : pool;
    const q = choices[Math.floor(Math.random() * choices.length)];
    lastEyeId = q.id;
    const conf = RATING_CONFIG[q.rating], p = PERSON_CONFIG[q.person];
    $('eyeScope').textContent = selectedPerson === 'ALL' ? 'Wszyscy' : selectedPerson;
    $('eyeBody').innerHTML = `
        <div class="flex items-center gap-2 flex-wrap mb-3">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-bold uppercase tracking-wider ${p.badgeClass}"><i class="fa-solid ${p.icon}"></i> ${esc(q.person)}</span>
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${conf.bgClass} ${conf.colorClass}"><i class="fa-solid ${conf.icon}"></i> ${esc(q.rating)}</span>
        </div>
        <blockquote class="text-lg sm:text-xl font-semibold text-white italic leading-snug border-l-2 border-purple-700/60 pl-3">„${esc(q.quote)}”</blockquote>
        <p class="text-xs text-gray-400 mt-3">${esc(q.context)} · <span class="font-mono">${esc(q.date)}</span></p>
        <div class="mt-3 text-xs text-gray-300 leading-relaxed bg-darkBg/60 p-3 rounded-xl border border-darkBorder/60"><strong class="text-purple-300">Uzasadnienie:</strong> ${esc(q.reason)}</div>`;
    $('eyeOverlay').classList.remove('hidden');
    eyeSound();
}
const closeEye = () => $('eyeOverlay').classList.add('hidden');

// ---------- Automatyczne odświeżanie (gdy działa baza) ----------
async function pollQuotes() {
    if (document.hidden) return;
    try {
        const r = await dbFetch('quotes?select=*&approved=eq.true&order=date.desc');
        if (!r.ok) return;
        const d = await r.json();
        if (!Array.isArray(d)) return;
        const next = clean(d).ok;
        if (JSON.stringify(next) !== JSON.stringify(quotes)) { quotes = next; refresh(); }
    } catch { /* brak sieci – spróbujemy za chwilę */ }
}
function startPolling() {
    setInterval(pollQuotes, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pollQuotes(); });
}

// ---------- Start ----------
document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.admin-only').forEach(el => { if (DB || !isAdmin) el.remove(); });
    const note = document.querySelector('#submit p');
    if (note && DB) note.textContent = 'Wybierz osobę, wpisz cytat, kontekst i uzasadnienie. ' + (AUTO ? 'Wpis pojawi się na stronie od razu.' : 'Wpis pojawi się na stronie po akceptacji administratora.');
    else if (note && !isAdmin) note.textContent = 'Dodawanie cytatów jest wyłączone: strona nie widzi konfiguracji bazy (uzupełnij config.js).';

    // powiąż <label> z polami (dostępność)
    document.querySelectorAll('label').forEach(l => {
        const f = l.parentElement.querySelector('input,select,textarea');
        if (f && f.id && !l.htmlFor && !l.contains(f)) l.htmlFor = f.id;
    });
    if ($('quoteDate')) $('quoteDate').value = today();

    await loadQuotes();
    setPersonFilter('ALL');
    setActive('.verdict-filter-btn', 'data-filter-verdict', 'ALL', VERDICT_ON, 'bg-darkBg text-gray-300');
    setActive('.cat-filter-btn', 'data-filter-cat', 'ALL', CAT_ON, 'bg-darkBg text-gray-400');
    if (DB) startPolling();

    document.querySelectorAll('.person-tab-btn').forEach(b => b.addEventListener('click', () => setPersonFilter(b.dataset.personSelect)));
    document.querySelectorAll('.verdict-filter-btn').forEach(b => b.addEventListener('click', () => {
        verdictFilter = b.dataset.filterVerdict;
        setActive('.verdict-filter-btn', 'data-filter-verdict', verdictFilter, VERDICT_ON, 'bg-darkBg text-gray-300');
        renderCards();
    }));
    document.querySelectorAll('.cat-filter-btn').forEach(b => b.addEventListener('click', () => {
        catFilter = b.dataset.filterCat;
        setActive('.cat-filter-btn', 'data-filter-cat', catFilter, CAT_ON, 'bg-darkBg text-gray-400');
        renderCards();
    }));
    on('searchInput', 'input', e => { searchQuery = e.target.value; renderCards(); });
    on('sortSelect', 'change', e => { currentSort = e.target.value; renderCards(); });
    on('cardsContainer', 'click', e => {
        const btn = e.target.closest('[data-action]');
        if (btn) actions[btn.dataset.action]?.(Number(btn.dataset.id));
    });

    // Modal: Escape i kliknięcie w tło
    on('closeModalBtn', 'click', closeModal);
    on('cancelEditBtn', 'click', closeModal);
    on('editModal', 'click', e => { if (e.target === $('editModal')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeEye(); } });
    on('eyeCloseBtn', 'click', closeEye);
    on('eyeAgainBtn', 'click', triggerEyeOfTruth);
    on('eyeOverlay', 'click', e => { if (e.target === $('eyeOverlay')) closeEye(); });

    // Admin
    on('addQuoteForm', 'submit', async e => {
        e.preventDefault();
        const q = {
            id: nextId(), person: $('quotePerson').value, category: $('quoteCategory').value,
            quote: $('quoteText').value.trim(), context: $('quoteContext').value.trim(),
            rating: $('quoteRating').value, date: $('quoteDate').value, reason: $('quoteReason').value.trim(), likes: 0
        };
        if (!clean([q]).ok.length) { showToast('Błąd', 'Uzupełnij wszystkie pola.'); return; }
        if (DB) {
            if ($('hp_contact')?.value) return; // pułapka na boty
            if (Date.now() - (Number(store.get(COOLDOWN_KEY)) || 0) < 30000) {
                showToast('Chwila…', 'Odczekaj 30 sekund przed kolejnym zgłoszeniem.'); return;
            }
            const { id, likes, ...payload } = q;
            try {
                const r = await dbFetch('quotes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
                if (!r.ok) { const err = await r.json().catch(() => ({})); throw new Error(`Kod ${r.status}: ${err.message || 'nieznany błąd'}`); }
                store.set(COOLDOWN_KEY, Date.now());
                e.target.reset(); $('quoteDate').value = today();
                if (AUTO) { await loadQuotes(); refresh(); }
                showToast('Wysłano!', AUTO ? 'Wpis jest już na stronie.' : 'Wpis pojawi się na stronie po akceptacji.');
            } catch (err) { console.error(err); showToast('Nie udało się wysłać', String(err.message || 'Spróbuj ponownie.'), 12000); }
            return;
        }
        if (!isAdmin) { showToast('Dodawanie wyłączone', 'Brak konfiguracji bazy w config.js.'); return; }
        quotes.unshift(q);
        persist(); refresh();
        e.target.reset();
        $('quoteDate').value = today();
        showToast('Dodano wypowiedź!', `Przypisano do: ${q.person}`);
    });
    on('editQuoteForm', 'submit', e => {
        e.preventDefault();
        const q = quotes.find(x => x.id === Number($('editQuoteId').value));
        if (!q) return;
        Object.assign(q, {
            person: $('editQuotePerson').value, category: $('editQuoteCategory').value,
            quote: $('editQuoteText').value.trim(), context: $('editQuoteContext').value.trim(),
            rating: $('editQuoteRating').value, date: $('editQuoteDate').value, reason: $('editQuoteReason').value.trim()
        });
        persist(); refresh(); closeModal();
        showToast('Zaktualizowano!', 'Wypowiedź została zapisana w szkicu.');
    });
    on('exportJsonBtn', 'click', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(quotes, null, 2)], { type: 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: 'quotes.json' });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    on('importJsonInput', 'change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!Array.isArray(data)) throw new Error('not array');
                const { ok, bad } = clean(data);
                if (!ok.length && data.length) throw new Error('nothing valid');
                if (!confirm(`Zastąpić szkic? Poprawnych wpisów: ${ok.length}, odrzuconych: ${bad}.`)) return;
                quotes = ok; persist(); refresh();
                showToast('Zaimportowano!', `Wgrano ${ok.length} wypowiedzi (odrzucono: ${bad}).`);
            } catch { showToast('Błąd importu', 'Plik musi być tablicą poprawnych wpisów JSON.'); }
            e.target.value = '';
        };
        reader.readAsText(file);
    });
    on('generateCodeBtn', 'click', () => {
        $('codeTextarea').value = JSON.stringify(quotes, null, 2);
        $('codeOutputBox').classList.remove('hidden');
    });
    on('copyCodeBtn', 'click', async () => {
        const ok = await copyText($('codeTextarea').value);
        showToast(ok ? 'Skopiowano!' : 'Nie udało się skopiować', ok ? 'Wklej do quotes.json w repozytorium.' : 'Zaznacz tekst ręcznie.');
    });
    on('resetDataBtn', 'click', async () => {
        if (!confirm('Odrzucić lokalne zmiany i wrócić do quotes.json?')) return;
        store.del(DRAFT_KEY);
        const draftOff = isAdmin; // wczytaj ponownie bez szkicu
        await loadQuotes();
        refresh();
        showToast('Zresetowano', draftOff ? 'Przywrócono dane z quotes.json.' : '');
    });
});
