// ═══════════════════════════════════════
//  vue-analyse.js — Analyse et objectifs : graphiques interactifs + rapport PDF paysage
//  Sources : COMPTES, OBJECTIFS_PRIMES, PARAMS (SheetsAPI). Périmètre : ADMIN/CHANNEL = tout, CDS = ses comptes.
//  Règle « activé » (validée 3 nov. 2026) : compte Empower onboardé ayant passé une première commande
//  (CA Empower > 0 sur une période, ou signal sell-in « dernière semaine de commande »).
//  Graphiques : survol = infobulle, clic = détail dessous. Rapport : sections cochées → impression PDF A4 paysage.
// ═══════════════════════════════════════

window.VueAnalyse = {

  COUL: { Empower: '#2F6FEB', Grossiste: '#C98A1B', 'À qualifier': '#8A949E', actif: '#1E9E6A', inactif: '#B9C0C7' },
  PERIODES: ['FY25', 'FY26', 'Q1FY27', 'Q2FY27', 'Q3FY27', 'Q4FY27'],
  SECTIONS: [['canaux', 'Comptes par canal'], ['tracker', 'Tracker Empower : activés / non activés'], ['objectifs', 'Atteinte des objectifs']],
  state: { chargement: true, erreur: null, comptes: [], objectifs: [], quarter: 'Q1', onglet: 'vue', sel: null, choix: { canaux: true, tracker: true, objectifs: true } },

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  // Compte Empower onboardé ? / activé (première commande Empower passée) ?
  estOnboarde(c) { return window.estEmpower ? estEmpower(c) : false; },
  estActive(c) {
    return this.estOnboarde(c) && (this.PERIODES.some(p => Number(c['CA_EMP_' + p]) > 0) || !!String(c.SellIn_Derniere_Semaine || '').trim());
  },

  async init() {
    Object.assign(this.state, { chargement: true, erreur: null, sel: null });
    this.render();
    try {
      const [comptes, objectifs, params] = await Promise.all([
        SheetsAPI.lire('EMPOWER_MDB', 'COMPTES'),
        SheetsAPI.lire('EMPOWER_MDB', 'OBJECTIFS_PRIMES').catch(() => []),
        SheetsAPI.lire('EMPOWER_MDB', 'PARAMS').catch(() => []),
      ]);
      const ok = r => !String(r.deleted || '').toUpperCase().includes('TRUE');
      const mien = pin => Session.voitTout() || Number(pin) === Session.pin;
      this.state.comptes = (comptes || []).filter(ok).filter(c => mien(c.PIN_CDS_Assigne));
      this.state.objectifs = (objectifs || []).filter(o => mien(o.PIN_CDS));
      const pm = Object.fromEntries((params || []).map(p => [p.Parametre, p.Valeur]));
      this.state.quarter = pm.QuarterActif || 'Q1';
    } catch (e) { this.state.erreur = e.message; }
    this.state.chargement = false;
    this.render();
  },

  _nom(pin) { return pin ? window.resolveCDS(pin) : 'Non attribué'; },

  // ── Données agrégées ──
  _canaux() {
    const n = { Empower: [], Grossiste: [], 'À qualifier': [] };
    this.state.comptes.forEach(c => { const k = (window.Canaux && Canaux.normaliser(c.CANAL)) || 'À qualifier'; (n[k] || n['À qualifier']).push(c); });
    return n;
  },
  _tracker() {
    const g = {};
    this.state.comptes.filter(c => this.estOnboarde(c)).forEach(c => {
      const k = c.PIN_CDS_Assigne || 0; const o = (g[k] = g[k] || { actif: [], inactif: [] });
      (this.estActive(c) ? o.actif : o.inactif).push(c);
    });
    return g;
  },
  _objectifs() {
    const q = this.state.quarter, P = window.parseCA || Number;
    return this.state.objectifs.map(o => {
      const ca = P(o[q + '_CA_Realise']) || 0, obj = P(o[q + '_Obj_Revise'] || o[q + '_Obj_Initial']) || 0;
      return { pin: o.PIN_CDS, nom: o.Nom_CDS || this._nom(o.PIN_CDS), ca, obj, pct: obj > 0 ? ca / obj * 100 : 0 };
    }).sort((a, b) => b.pct - a.pct);
  },

  // ── Graphiques (SVG, interactifs) ──
  _donut() {
    const d = this._canaux(), cles = Object.keys(d), tot = cles.reduce((s, k) => s + d[k].length, 0) || 1;
    let a0 = -Math.PI / 2; const R = 80, r = 50;
    const arcs = cles.filter(k => d[k].length).map(k => {
      const a1 = a0 + (d[k].length / tot) * Math.PI * 2 - (d[k].length === tot ? 0.0001 : 0), big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${100 + rad * Math.cos(a)},${100 + rad * Math.sin(a)}`;
      const path = `M${p(R, a0)} A${R},${R} 0 ${big} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${big} 0 ${p(r, a0)}Z`; a0 = a1;
      return `<path d="${path}" fill="${this.COUL[k]}" tabindex="0" role="button" data-sel="canal:${k}" data-tip="${k} : ${d[k].length} compte${d[k].length > 1 ? 's' : ''} (${Math.round(d[k].length / tot * 100)} %)" aria-label="${k} : ${d[k].length} compte${d[k].length > 1 ? 's' : ''}"/>`;
    }).join('');
    const leg = cles.map(k => `<li><span style="background:${this.COUL[k]}"></span>${k} <strong>${d[k].length}</strong></li>`).join('');
    return `<div class="an-donut"><svg viewBox="0 0 200 200" role="group" aria-label="Comptes par canal">${arcs}<text x="100" y="98" text-anchor="middle" font-size="22" font-weight="700">${tot}</text><text x="100" y="116" text-anchor="middle" font-size="10">comptes</text></svg><ul class="an-leg">${leg}</ul></div>`;
  },
  _tracker_svg() {
    const g = this._tracker(), pins = Object.keys(g).sort((a, b) => (g[b].actif.length + g[b].inactif.length) - (g[a].actif.length + g[a].inactif.length));
    if (!pins.length) return '<p class="an-vide">Aucun compte Empower onboardé dans ce périmètre.</p>';
    const max = Math.max(...pins.map(p => g[p].actif.length + g[p].inactif.length)), W = 420;
    const lignes = pins.map((p, i) => {
      const a = g[p].actif.length, n = g[p].inactif.length, y = 8 + i * 34, sc = (W - 130) / max;
      return `<text x="0" y="${y + 17}" font-size="12">${this._esc(this._nom(Number(p)))}</text>
        <rect x="100" y="${y}" width="${Math.max(a * sc, 0)}" height="24" fill="${this.COUL.actif}" rx="3" tabindex="0" role="button" data-sel="trk:${p}:actif" data-tip="${this._esc(this._nom(Number(p)))} : ${a} activé${a > 1 ? 's' : ''} (1re commande passée)" aria-label="${a} activés"/>
        <rect x="${100 + a * sc}" y="${y}" width="${Math.max(n * sc, 0)}" height="24" fill="${this.COUL.inactif}" rx="3" tabindex="0" role="button" data-sel="trk:${p}:inactif" data-tip="${this._esc(this._nom(Number(p)))} : ${n} non activé${n > 1 ? 's' : ''} (pas encore de commande)" aria-label="${n} non activés"/>
        <text x="${104 + (a + n) * sc}" y="${y + 17}" font-size="12">${a}/${a + n}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${pins.length * 34 + 10}" role="group" aria-label="Tracker Empower">${lignes}</svg>
      <ul class="an-leg"><li><span style="background:${this.COUL.actif}"></span>Activés (1re commande passée)</li><li><span style="background:${this.COUL.inactif}"></span>Non activés</li></ul>`;
  },
  _obj_svg() {
    const o = this._objectifs(); if (!o.length) return '<p class="an-vide">Aucun objectif pour ce trimestre.</p>';
    const W = 420, sc = (W - 150) / Math.max(120, ...o.map(x => x.pct));
    return `<svg viewBox="0 0 ${W} ${o.length * 34 + 22}" role="group" aria-label="Atteinte des objectifs ${this.state.quarter}">
      ${o.map((x, i) => { const y = 8 + i * 34; return `<text x="0" y="${y + 17}" font-size="12">${this._esc(x.nom)}</text>
        <rect x="100" y="${y}" width="${Math.max(x.pct * sc, 1)}" height="24" rx="3" fill="${x.pct >= 100 ? this.COUL.actif : x.pct >= 80 ? '#C98A1B' : '#C0453F'}" tabindex="0" role="button" data-sel="obj:${x.pin}" data-tip="${this._esc(x.nom)} : ${Math.round(x.pct)} % (${Math.round(x.ca)} € / ${Math.round(x.obj)} €)" aria-label="${Math.round(x.pct)} %"/>
        <text x="${104 + x.pct * sc}" y="${y + 17}" font-size="12">${Math.round(x.pct)} %</text>`; }).join('')}
      <line x1="${100 + 100 * sc}" x2="${100 + 100 * sc}" y1="0" y2="${o.length * 34 + 8}" stroke="currentColor" stroke-dasharray="3 3" opacity=".5"/>
      <text x="${100 + 100 * sc}" y="${o.length * 34 + 20}" font-size="10" text-anchor="middle">objectif</text></svg>`;
  },

  _detail() {
    const s = this.state.sel; if (!s) return '';
    const [t, a, b] = s.split(':'); let titre = '', l = [];
    if (t === 'canal') { l = this._canaux()[a] || []; titre = `Comptes ${a}`; }
    if (t === 'trk') { l = (this._tracker()[a] || {})[b] || []; titre = `${this._nom(Number(a))} · ${b === 'actif' ? 'activés' : 'non activés'}`; }
    if (t === 'obj') { return `<div class="an-det"><h3>${this._esc(this._nom(Number(a)))}</h3><p><a href="#/objectifs">Ouvrir Objectifs</a> · <a href="#/primes">Primes</a></p></div>`; }
    return `<div class="an-det"><h3>${this._esc(titre)} (${l.length})</h3><ul>${l.slice(0, 60).map(c => `<li><a href="#/compte/${encodeURIComponent(c.ID_Compte || c._uuid)}">${this._esc(c.Nom_Compte)}</a> <span>${this._esc(c.Ville || '')}</span></li>`).join('')}</ul>${l.length > 60 ? `<p>60 premiers sur ${l.length}.</p>` : ''}</div>`;
  },

  _bloc(id, titre, corps) { return `<section class="an-card" data-bloc="${id}"><h2>${titre}</h2>${corps}</section>`; },
  _blocs() {
    return { canaux: this._bloc('canaux', 'Comptes par canal', this._donut()), tracker: this._bloc('tracker', 'Tracker Empower : activés / non activés', this._tracker_svg()), objectifs: this._bloc('objectifs', `Atteinte des objectifs ${this.state.quarter}`, this._obj_svg()) };
  },

  // ── Rapport PDF paysage : sections cochées, mise en page A4 paysage, impression navigateur ──
  genererPDF() {
    const s = this.state, b = this._blocs(), ids = this.SECTIONS.map(x => x[0]).filter(k => s.choix[k]);
    if (!ids.length) { if (window.Toast) Toast.afficher('Coche au moins une section', 'erreur'); return; }
    const w = window.open('', '_blank'); if (!w) { if (window.Toast) Toast.afficher('Fenêtre bloquée : autorise les pop-ups', 'erreur'); return; }
    const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport ESI</title><style>
      @page{size:A4 landscape;margin:12mm}body{font-family:system-ui,sans-serif;color:#1d252c;margin:0}
      header{display:flex;justify-content:space-between;border-bottom:3px solid #FF6D68;padding-bottom:6px;margin-bottom:12px}
      h1{font-size:20px;margin:0}.an-card{break-inside:avoid;page-break-inside:avoid;border:1px solid #d5dade;border-radius:10px;padding:12px;margin:0 0 12px}
      .an-card h2{font-size:15px;margin:0 0 8px}svg{max-width:100%;height:auto;max-height:150mm}.an-leg{display:flex;gap:14px;list-style:none;padding:0;font-size:12px}
      .an-leg span{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}.an-donut{display:flex;align-items:center;gap:20px}.an-donut svg{width:200px}
      footer{font-size:10px;color:#6b757d;margin-top:8px}</style></head><body>
      <header><h1>EMPOWER SALES INTELLIGENCE · Rapport</h1><div>${this._esc(Session.nom || '')} · ${date}</div></header>
      ${ids.map(k => b[k]).join('')}<footer>Généré depuis l'application · périmètre ${Session.voitTout() ? 'équipe' : 'personnel'}</footer></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => { try { w.print(); } catch (e) { /* l'utilisateur peut imprimer manuellement */ } }, 400);
  },

  render() {
    const app = document.getElementById('app'), s = this.state; if (!app) return;
    const entete = `<header class="header-vue"><h1>Analyse et objectifs</h1></header>${NavBar('analyse')}${typeof FusionTabs === 'function' ? FusionTabs.pilotage() : ''}`;
    if (s.chargement) { app.innerHTML = entete + '<p style="padding:16px">Chargement…</p>'; return; }
    if (s.erreur) { app.innerHTML = entete + `<p style="padding:16px">Erreur : ${this._esc(s.erreur)}</p>`; return; }
    const b = this._blocs();
    const onglets = [['vue', 'Vue d’ensemble'], ['rapport', 'Rapport']].map(([k, l]) => `<button class="tab-btn-premium ${s.onglet === k ? 'actif' : ''}" data-onglet="${k}">${l}</button>`).join('');
    const corps = s.onglet === 'rapport' ? `<section class="an-card"><h2>Rapport PDF (paysage)</h2>
        <p style="font-size:13px">Choisis les éléments, puis génère le PDF : la fenêtre d'impression s'ouvre, choisis « Enregistrer au format PDF ». Mise en page A4 paysage avec les graphiques.</p>
        ${this.SECTIONS.map(([k, l]) => `<label style="display:block;margin:6px 0"><input type="checkbox" data-choix="${k}" ${s.choix[k] ? 'checked' : ''}> ${l}</label>`).join('')}
        <button class="btn-primaire" id="an-pdf" style="margin-top:10px">Générer le PDF</button>
        <p style="font-size:11px;opacity:.7;margin-top:8px">Export PowerPoint : non disponible (nécessite une bibliothèque à valider).</p></section>
        <div class="an-grid">${this.SECTIONS.filter(([k]) => s.choix[k]).map(([k]) => b[k]).join('')}</div>`
      : `<div class="an-grid">${b.canaux}${b.tracker}${b.objectifs}</div>${this._detail()}`;
    app.innerHTML = `<style>
      .an{padding:12px 16px 90px}.an-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.an-card{background:var(--bg-surface,#fff);border:1px solid var(--border-strong,#d5dade);border-radius:12px;padding:12px}
      .an-card h2{font-size:15px;margin:0 0 8px}.an-card svg{width:100%;height:auto}.an-card path,.an-card rect{cursor:pointer;outline-offset:2px}.an-card path:focus-visible,.an-card rect:focus-visible{stroke:#FF6D68;stroke-width:2}
      .an-donut{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.an-donut svg{width:170px;flex:none}.an-leg{display:flex;flex-wrap:wrap;gap:10px 14px;list-style:none;padding:0;margin:8px 0 0;font-size:12px}
      .an-leg span{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}.an-det{margin-top:12px;background:var(--bg-surface,#fff);border:1px solid var(--border-strong,#d5dade);border-radius:12px;padding:12px}
      .an-det ul{list-style:none;padding:0;margin:0}.an-det li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-strong,#e3e6e9);font-size:13px}.an-det li span{opacity:.6}
      .an-vide{font-size:13px;opacity:.7}#an-tip{position:fixed;z-index:2000;pointer-events:none;background:#343F48;color:#fff;font-size:12px;padding:6px 9px;border-radius:6px;display:none;max-width:240px}</style>
      ${entete}<div class="an"><div style="display:flex;gap:8px;margin-bottom:10px">${onglets}</div>${corps}</div><div id="an-tip" role="tooltip"></div>`;
    this._bind(app);
  },

  _bind(app) {
    const s = this.state, tip = app.querySelector('#an-tip');
    const montre = (e, t) => { tip.textContent = t; tip.style.display = 'block'; tip.style.left = Math.min(e.clientX + 12, innerWidth - 250) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; };
    app.querySelectorAll('[data-tip]').forEach(el => {
      el.onmousemove = e => montre(e, el.dataset.tip); el.onmouseleave = () => { tip.style.display = 'none'; };
      el.onfocus = () => { const r = el.getBoundingClientRect(); montre({ clientX: r.left + r.width / 2, clientY: r.top }, el.dataset.tip); }; el.onblur = () => { tip.style.display = 'none'; };
    });
    app.querySelectorAll('[data-sel]').forEach(el => {
      const go = () => { s.sel = s.sel === el.dataset.sel ? null : el.dataset.sel; this.render(); };
      el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    app.querySelectorAll('[data-onglet]').forEach(b => b.onclick = () => { s.onglet = b.dataset.onglet; this.render(); });
    app.querySelectorAll('[data-choix]').forEach(c => c.onchange = () => { s.choix[c.dataset.choix] = c.checked; this.render(); });
    const pdf = app.querySelector('#an-pdf'); if (pdf) pdf.onclick = () => this.genererPDF();
  },
};
