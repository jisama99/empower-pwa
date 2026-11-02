// ═══════════════════════════════════════
//  vue-territoires.js — Carte des territoires (droit « territoires »)
//  Carte interactive par département + cartes « visites par commercial »
//  selon la région. Sources : COMPTES et VISITES (SheetsAPI), géométrie :
//  js/france-deps.js (window.FR, GeoJSON simplifié, aucun appel externe).
//  Périmètre : ADMIN / CHANNEL_MANAGER = tout ; CDS = ses comptes et visites ;
//  EXTERNE = agrégats par département seulement (aucun nom de compte).
// ═══════════════════════════════════════

window.VueTerritoires = {

  REG: { '11': 'Île-de-France', '24': 'Centre-Val de Loire', '27': 'Bourgogne-Franche-Comté', '28': 'Normandie',
         '32': 'Hauts-de-France', '44': 'Grand Est', '52': 'Pays de la Loire', '53': 'Bretagne', '75': 'Nouvelle-Aquitaine',
         '76': 'Occitanie', '84': 'Auvergne-Rhône-Alpes', '93': 'Provence-Alpes-Côte d’Azur', '94': 'Corse' },

  state: { chargement: true, erreur: null, comptes: [], visites: [], reg: '', dep: '', calque: 'comptes', plein: false },

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  // Code département depuis un champ Departement ou un code postal ; null si illisible.
  _dep(dep, cp) {
    const d = String(dep || '').trim().toUpperCase();
    let m = d.match(/^(2A|2B|\d{2,3})/);
    if (m) { const c = m[1]; return c.length === 3 ? c.slice(0, 2) : c; }
    if (/^\d$/.test(d)) return '0' + d;
    const p = String(cp || '').trim();
    if (/^\d{5}$/.test(p)) {
      if (p.startsWith('20')) return Number(p.slice(0, 3)) <= 201 ? '2A' : '2B';
      return p.slice(0, 2);
    }
    return null;
  },

  async init() {
    this.state.chargement = true; this.state.erreur = null;
    this.render();
    try {
      const [comptes, visites] = await Promise.all([
        SheetsAPI.lire('EMPOWER_MDB', 'COMPTES'),
        SheetsAPI.lire('EMPOWER_MDB', 'VISITES').catch(() => []),
      ]);
      const ok = r => !String(r.deleted || '').toUpperCase().includes('TRUE');
      const monPerimetre = pin => Session.voitTout() || Session.estExterne() || Number(pin) === Session.pin;
      this.state.comptes = (comptes || []).filter(ok)
        .filter(c => monPerimetre(c.PIN_CDS_Assigne))
        .map(c => ({ id: c.ID_Compte || c._uuid, nom: c.Nom_Compte, ville: c.Ville, pin: c.PIN_CDS_Assigne,
                     canal: c.CANAL, dep: this._dep(c.Departement, c.Code_Postal) }));
      this.state.visites = (visites || []).filter(ok)
        .filter(v => monPerimetre(v.PIN_CDS))
        .map(v => ({ pin: v.PIN_CDS, date: String(v.Date || v.Date_Planif || '').slice(0, 10), dep: this._dep(v.Departement, null) }));
    } catch (e) { this.state.erreur = e.message; }
    this.state.chargement = false;
    this.render();
  },

  _dataDeps() {
    const s = this.state, par = {};
    const get = c => (par[c] = par[c] || { comptes: 0, visites: 0 });
    s.comptes.forEach(c => { if (c.dep) get(c.dep).comptes++; });
    s.visites.forEach(v => { if (v.dep) get(v.dep).visites++; });
    return par;
  },

  _carte(par) {
    const s = this.state, deps = (window.FR && window.FR.deps) || [];
    const val = c => (par[c] ? par[c][s.calque] : 0), max = Math.max(1, ...deps.map(d => val(d.c)));
    const paths = deps.filter(d => !s.reg || d.r === s.reg).concat(s.reg ? [] : []).map(d => {
      const v = val(d.c), a = v ? (0.18 + 0.72 * v / max).toFixed(2) : 0;
      const sel = s.dep === d.c;
      return `<path d="${d.d}" data-dep="${d.c}" tabindex="0" role="button" aria-label="${this._esc(d.n)} : ${v} ${s.calque}"
        fill="${sel ? 'var(--terr-sel)' : v ? 'var(--terr-fill)' : 'var(--terr-vide)'}" fill-opacity="${sel ? 1 : v ? a : 1}"
        stroke="var(--terr-trait)" stroke-width=".25"><title>${this._esc(d.n)} (${d.c}) : ${v}</title></path>`;
    }).join('');
    let vb = `0 0 ${window.FR.w} ${window.FR.h}`;
    if (s.reg) {
      const xs = deps.filter(d => d.r === s.reg);
      if (xs.length) {
        const x0 = Math.min(...xs.map(d => d.cx)) - 8, x1 = Math.max(...xs.map(d => d.cx)) + 8,
              y0 = Math.min(...xs.map(d => d.cy)) - 8, y1 = Math.max(...xs.map(d => d.cy)) + 8;
        vb = `${x0} ${y0} ${Math.max(x1 - x0, 20)} ${Math.max(y1 - y0, 20)}`;
      }
    }
    return `<svg viewBox="${vb}" role="group" aria-label="Carte des départements" class="terr-svg">${paths}</svg>`;
  },

  _cartesCommerciaux() {
    const s = this.state, deps = new Set(((window.FR && window.FR.deps) || [])
      .filter(d => (!s.reg || d.r === s.reg) && (!s.dep || d.c === s.dep)).map(d => d.c));
    const g = {};
    s.visites.filter(v => v.dep && deps.has(v.dep)).forEach(v => {
      const o = (g[v.pin] = g[v.pin] || { n: 0, last: '', deps: {} });
      o.n++; if (v.date > o.last) o.last = v.date; o.deps[v.dep] = (o.deps[v.dep] || 0) + 1;
    });
    const noms = Object.keys(g).sort((a, b) => g[b].n - g[a].n);
    if (!noms.length) return `<p class="terr-vide-msg">Aucune visite localisée dans ce périmètre.</p>`;
    const fd = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—';
    return noms.map(p => `<article class="terr-card"><h3>${this._esc(window.resolveCDS(p))}</h3>
      <div class="terr-n">${g[p].n} <span>visite${g[p].n > 1 ? 's' : ''}</span></div>
      <div class="terr-sub">Dernière : ${fd(g[p].last)}</div>
      <div class="terr-sub">${Object.keys(g[p].deps).sort().map(d => `${d} (${g[p].deps[d]})`).join(' · ')}</div></article>`).join('');
  },

  _liste() {
    const s = this.state;
    if (Session.estExterne()) return '';
    const deps = new Set(((window.FR && window.FR.deps) || []).filter(d => (!s.reg || d.r === s.reg) && (!s.dep || d.c === s.dep)).map(d => d.c));
    const l = s.comptes.filter(c => c.dep && deps.has(c.dep)).sort((a, b) => String(a.nom).localeCompare(String(b.nom)));
    return `<section aria-label="Comptes du périmètre"><h2>Comptes (${l.length})</h2><ul class="terr-liste">${
      l.slice(0, 200).map(c => `<li><a href="#/compte/${encodeURIComponent(c.id)}">${this._esc(c.nom)}</a>
        <span>${this._esc(c.ville || '—')} · ${this._esc(c.dep)}${c.canal ? ' · ' + this._esc(c.canal) : ''}</span></li>`).join('')
    }</ul>${l.length > 200 ? `<p class="terr-sub">200 premiers affichés sur ${l.length}.</p>` : ''}</section>`;
  },

  render() {
    const app = document.getElementById('app'), s = this.state;
    if (!app) return;
    if (s.chargement) { app.innerHTML = '<div class="header-vue"><h1>Territoires</h1></div><p style="padding:16px">Chargement…</p>'; return; }
    if (s.erreur) { app.innerHTML = `<div class="header-vue"><h1>Territoires</h1></div><p style="padding:16px">Erreur : ${this._esc(s.erreur)}</p>`; return; }
    const par = this._dataDeps(), nonLoc = s.comptes.filter(c => !c.dep).length;
    const regs = Object.keys(this.REG).filter(r => window.FR.deps.some(d => d.r === r));
    const deps = window.FR.deps.filter(d => !s.reg || d.r === s.reg);
    app.innerHTML = `<style>
      .terr{--terr-fill:#343F48;--terr-sel:#FF6D68;--terr-vide:#E6E9EC;--terr-trait:#fff;padding:12px 16px 80px}
      @media (prefers-color-scheme:dark){.terr{--terr-vide:#2b333a;--terr-trait:#14181c}}
      .terr-bar{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.terr-bar select,.terr-bar button{padding:8px 10px;border-radius:8px;border:1px solid var(--border-strong,#ccd);background:var(--bg-surface,#fff);color:inherit;font:inherit}
      .terr-bar button[aria-pressed=true]{background:#FF6D68;color:#fff;border-color:#FF6D68}
      .terr-map{position:relative;background:var(--bg-surface,#fff);border-radius:12px;padding:8px}.terr-svg{width:100%;max-height:70vh;display:block}
      .terr-svg path{cursor:pointer;outline-offset:1px}.terr-svg path:focus-visible{stroke:#FF6D68;stroke-width:.8}
      .terr.plein .terr-map{position:fixed;inset:0;z-index:1000;border-radius:0;padding:16px}.terr.plein .terr-svg{height:calc(100vh - 80px);max-height:none}
      .terr-fs{position:absolute;top:10px;right:10px}.terr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
      .terr-card{border:1px solid var(--border-strong,#ccd);border-radius:12px;padding:12px;background:var(--bg-surface,#fff)}
      .terr-card h3{margin:0 0 4px;font-size:14px}.terr-n{font-size:26px;font-weight:700}.terr-n span{font-size:13px;font-weight:400}
      .terr-sub{font-size:12px;opacity:.7;margin-top:2px}.terr-liste{list-style:none;padding:0;margin:0}.terr-liste li{display:flex;flex-direction:column;padding:8px 0;border-bottom:1px solid var(--border-strong,#dde)}
      .terr h2{font-size:15px;margin:18px 0 8px}
    </style>
    <div class="header-vue"><h1>Territoires</h1></div>
    <div class="terr${s.plein ? ' plein' : ''}">
      <div class="terr-bar" role="group" aria-label="Filtres">
        <select id="terr-reg" aria-label="Région"><option value="">Toutes les régions</option>${regs.map(r => `<option value="${r}"${s.reg === r ? ' selected' : ''}>${this.REG[r]}</option>`).join('')}</select>
        <select id="terr-dep" aria-label="Département"><option value="">Tous les départements</option>${deps.map(d => `<option value="${d.c}"${s.dep === d.c ? ' selected' : ''}>${d.c} ${this._esc(d.n)}</option>`).join('')}</select>
        <button data-calque="comptes" aria-pressed="${s.calque === 'comptes'}">Comptes</button>
        <button data-calque="visites" aria-pressed="${s.calque === 'visites'}">Visites</button>
      </div>
      <div class="terr-map">${this._carte(par)}<button class="terr-fs" id="terr-fs" aria-label="${s.plein ? 'Quitter le plein écran' : 'Carte en plein écran'}">${s.plein ? '⤡' : '⤢'}</button></div>
      ${nonLoc ? `<p class="terr-sub">${nonLoc} compte${nonLoc > 1 ? 's' : ''} sans département : non placés sur la carte.</p>` : ''}
      <h2>Visites par commercial${s.reg ? ' · ' + this.REG[s.reg] : ''}${s.dep ? ' · ' + s.dep : ''}</h2>
      <div class="terr-grid">${this._cartesCommerciaux()}</div>
      ${this._liste()}
    </div>`;
    this._bind(app);
  },

  _bind(app) {
    const s = this.state, rerender = () => this.render();
    app.querySelector('#terr-reg').onchange = e => { s.reg = e.target.value; s.dep = ''; rerender(); };
    app.querySelector('#terr-dep').onchange = e => { s.dep = e.target.value; rerender(); };
    app.querySelectorAll('[data-calque]').forEach(b => b.onclick = () => { s.calque = b.dataset.calque; rerender(); });
    app.querySelector('#terr-fs').onclick = () => { s.plein = !s.plein; rerender(); };
    app.querySelectorAll('path[data-dep]').forEach(p => {
      const go = () => { const c = p.dataset.dep; s.dep = s.dep === c ? '' : c; rerender(); };
      p.onclick = go; p.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    if (!this._esc2) {
      this._esc2 = true;
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && this.state.plein && document.querySelector('.terr')) { this.state.plein = false; this.render(); } });
    }
  },
};
