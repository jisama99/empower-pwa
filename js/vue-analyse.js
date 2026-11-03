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
  state: { chargement: true, erreur: null, comptes: [], objectifs: [], quarter: 'Q1', onglet: 'vue', sel: null, visites: [], leads: [] },

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
      const [comptes, objectifs, params, visites, leads] = await Promise.all([
        SheetsAPI.lire('EMPOWER_MDB', 'COMPTES'),
        SheetsAPI.lire('EMPOWER_MDB', 'OBJECTIFS_PRIMES').catch(() => []),
        SheetsAPI.lire('EMPOWER_MDB', 'PARAMS').catch(() => []),
        SheetsAPI.lire('EMPOWER_MDB', 'VISITES').catch(() => []),
        SheetsAPI.lire('EMPOWER_MDB', 'LEADS').catch(() => []),
      ]);
      const ok = r => !String(r.deleted || '').toUpperCase().includes('TRUE');
      const mien = pin => Session.voitTout() || Number(pin) === Session.pin;
      this.state.comptes = (comptes || []).filter(ok).filter(c => mien(c.PIN_CDS_Assigne));
      this.state.objectifs = (objectifs || []).filter(o => mien(o.PIN_CDS));
      this.state.visites = (visites || []).filter(ok).filter(v => mien(v.PIN_CDS));
      this.state.leads = (leads || []).filter(ok).filter(l => Session.voitTout() || Number(l.PIN_CDS_Assigne) === Session.pin);
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

  // ── Rapport (gabarit validé du refresh) : format, période, blocs, photos ; pages A4 paysage ──
  // Pages : couverture · blocs cochés (1 page chacun) · synthèse et prochaines actions.
  BLOCS: [
    ['visites', 'Visites de la semaine + photos', 'Liste datée, type de visite, photos terrain'],
    ['sellin', 'Sell-in par quarter / FY, par commercial et par compte', 'Barres par quarter, comptes ayant commandé'],
    ['atteinte', 'Atteinte % vs objectifs', 'Jauges par commercial'],
    ['portefeuille', 'Comptes par canal + pipeline + carte', 'Camembert, étapes, couverture des départements'],
  ],
  PERIODES_RAPPORT: ['Semaine fiscale', 'Quarter', 'FY27'],
  QUARTERS: { Q1: ['2026-04-01', '2026-06-30'], Q2: ['2026-07-01', '2026-09-30'], Q3: ['2026-10-01', '2026-12-31'], Q4: ['2027-01-01', '2027-03-31'] },

  _x() { const s = this.state; return s.rap || (s.rap = { fmt: 'PDF', per: 'Semaine fiscale', blocs: ['visites', 'sellin', 'atteinte', 'portefeuille'], photos: true }); },
  _pagesRapport() { const r = this._x(); return ['Couverture', ...this.BLOCS.filter(b => r.blocs.includes(b[0])).map(b => b[1]), 'Synthèse et prochaines actions']; },
  _fmt(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR'); },
  _libellePeriode() {
    const r = this._x(), q = this.state.quarter;
    if (r.per === 'Quarter') return q + ' FY27';
    if (r.per === 'FY27') return 'FY27 (avril 2026 à mars 2027)';
    try { return 'Semaine fiscale ' + (window.FiscalWeeks ? FiscalWeeks.labelDe() : 'en cours'); } catch (e) { return 'Semaine fiscale en cours'; }
  },
  _dansPeriode(d) {
    const r = this._x(), s = String(d || '').slice(0, 10); if (!s) return false;
    if (r.per === 'Quarter') { const b = this.QUARTERS[this.state.quarter]; return !!b && s >= b[0] && s <= b[1]; }
    if (r.per === 'FY27') return s >= '2026-04-01' && s <= '2027-03-31';
    try { return window.FiscalWeeks ? FiscalWeeks.dansSemaineCalendaire(s) : false; } catch (e) { return false; }
  },

  _pageHTML(titre, corps, n) {
    return `<section class="pg"><header><h2>${titre}</h2><span>${this._esc(this._libellePeriode())}</span></header><div class="pgc">${corps}</div><footer><span>Marvesting × Norton Empower</span><span>${n}</span></footer></section>`;
  },
  _pageVisites() {
    const s = this.state, r = this._x();
    const v = (s.visites || []).filter(x => this._dansPeriode(x.Date || x.Date_Planif)).sort((a, b) => String(b.Date || '').localeCompare(String(a.Date || '')));
    const lignes = v.slice(0, 14).map(x => `<tr><td>${this._esc(String(x.Date || x.Date_Planif || '').slice(0, 10))}</td><td>${this._esc(window.resolveCDS(x.PIN_CDS || x.Nom_CDS))}</td><td>${this._esc(x.Nom_Compte || '')}</td><td>${this._esc(x.Type_Visite || '')}</td></tr>`).join('');
    const photos = r.photos ? v.flatMap(x => String(x.Photo_URL || '').split(' | ').map(u => u.trim()).filter(Boolean).slice(0, 1)).slice(0, 6) : [];
    return `<p class="k"><b>${v.length}</b> visite${v.length > 1 ? 's' : ''} sur la période</p>
      ${lignes ? `<table><thead><tr><th>Date</th><th>Commercial</th><th>Compte</th><th>Type</th></tr></thead><tbody>${lignes}</tbody></table>${v.length > 14 ? `<p class="n">14 premières sur ${v.length}.</p>` : ''}` : '<p class="n">Aucune visite enregistrée sur la période.</p>'}
      ${photos.length ? `<div class="ph">${photos.map(u => `<img src="${this._esc(u)}" alt="Photo de visite" onerror="this.style.display='none'">`).join('')}</div>` : (r.photos ? '<p class="n">Aucune photo sur la période.</p>' : '')}`;
  },
  _pageSellin() {
    const s = this.state, P = window.parseCA || Number, qs = ['Q1', 'Q2', 'Q3', 'Q4'];
    const parQ = qs.map(q => s.objectifs.reduce((t, o) => t + (P(o[q + '_CA_Realise']) || 0), 0)), max = Math.max(1, ...parQ), W = 420;
    const barres = `<svg viewBox="0 0 ${W} 150">${parQ.map((v, i) => { const h = v / max * 110; return `<rect x="${30 + i * 98}" y="${125 - h}" width="64" height="${h}" fill="#343F48" rx="3"/><text x="${62 + i * 98}" y="141" text-anchor="middle" font-size="12">${qs[i]}</text><text x="${62 + i * 98}" y="${119 - h}" text-anchor="middle" font-size="11">${this._fmt(v)} €</text>`; }).join('')}</svg>`;
    const parCom = s.objectifs.map(o => `<tr><td>${this._esc(o.Nom_CDS || this._nom(o.PIN_CDS))}</td>${qs.map(q => `<td>${this._fmt(P(o[q + '_CA_Realise']))}</td>`).join('')}</tr>`).join('');
    const tot = c => ['Q1', 'Q2', 'Q3', 'Q4'].reduce((t, q) => t + (Number(c['CA_' + q + 'FY27']) || 0), 0);
    const top = s.comptes.filter(c => tot(c) > 0).sort((a, b) => tot(b) - tot(a)).slice(0, 8).map(c => `<tr><td>${this._esc(c.Nom_Compte)}</td><td>${this._esc(this._nom(c.PIN_CDS_Assigne))}</td><td>${this._fmt(tot(c))} €</td></tr>`).join('');
    return `<div class="duo"><div>${barres}<table><thead><tr><th>Commercial</th>${qs.map(q => `<th>${q}</th>`).join('')}</tr></thead><tbody>${parCom || '<tr><td colspan="5">Aucune donnée</td></tr>'}</tbody></table></div>
      <div><h3>Comptes ayant commandé (FY27)</h3><table><thead><tr><th>Compte</th><th>Commercial</th><th>CA</th></tr></thead><tbody>${top || '<tr><td colspan="3">Aucun</td></tr>'}</tbody></table></div></div>`;
  },
  _pageAtteinte() {
    const o = this._objectifs();
    return o.length ? o.map(x => `<div class="gj"><div class="gh"><b>${this._esc(x.nom)}</b><span>${this._fmt(x.ca)} € / ${this._fmt(x.obj)} €</span><strong style="color:${x.pct >= 100 ? '#12805C' : x.pct >= 80 ? '#D98200' : '#C0453F'}">${Math.round(x.pct)} %</strong></div><div class="gt"><i style="width:${Math.min(100, x.pct)}%;background:${x.pct >= 100 ? '#12805C' : x.pct >= 80 ? '#D98200' : '#C0453F'}"></i></div></div>`).join('') : '<p class="n">Aucun objectif pour ce trimestre.</p>';
  },
  _pagePortefeuille() {
    const s = this.state, st = {}; (s.leads || []).forEach(l => { const k = String(l.STATUT_EMPOWER || l.FLAG_ACTION || 'SAISIE'); st[k] = (st[k] || 0) + 1; });
    const deps = new Set(s.comptes.map(c => VueTerritoires && VueTerritoires._dep ? VueTerritoires._dep(c.Departement, c.Code_Postal) : null).filter(Boolean));
    return `<div class="duo"><div>${this._donut()}</div><div><h3>Pipeline (leads par statut)</h3><table><tbody>${Object.keys(st).sort().map(k => `<tr><td>${this._esc(k)}</td><td>${st[k]}</td></tr>`).join('') || '<tr><td>Aucun lead</td></tr>'}</tbody></table>
      <h3>Couverture</h3><p class="k"><b>${deps.size}</b> département${deps.size > 1 ? 's' : ''} avec au moins un compte (sur 96)</p></div></div>`;
  },
  _pageSynthese() {
    const t = this._tracker(), act = Object.values(t).reduce((n, g) => n + g.actif.length, 0), non = Object.values(t).reduce((n, g) => n + g.inactif.length, 0), o = this._objectifs();
    const sous = o.filter(x => x.pct < 80).map(x => x.nom);
    const lignes = [`${act} compte${act > 1 ? 's' : ''} Empower activé${act > 1 ? 's' : ''} (première commande passée), ${non} non activé${non > 1 ? 's' : ''}.`,
      non ? `Prochaine action : relancer ${non > 1 ? 'les ' + non + ' comptes Empower onboardés' : 'le compte Empower onboardé'} sans première commande.` : 'Aucun compte Empower en attente de première commande.',
      sous.length ? `Objectif sous 80 % : ${sous.join(', ')} : point d'accompagnement à prévoir.` : 'Aucun commercial sous 80 % de son objectif.'];
    return `<ul class="syn">${lignes.map(l => `<li>${this._esc(l)}</li>`).join('')}</ul>`;
  },

  genererPDF() {
    const r = this._x(), b = this.BLOCS.filter(x => r.blocs.includes(x[0]));
    if (!b.length) { if (window.Toast) Toast.afficher('Coche au moins un bloc', 'erreur'); return; }
    const w = window.open('', '_blank'); if (!w) { if (window.Toast) Toast.afficher('Fenêtre bloquée : autorise les pop-ups', 'erreur'); return; }
    const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }), fn = { visites: 'Visites', sellin: 'Sell-in', atteinte: 'Atteinte', portefeuille: 'Portefeuille' };
    const corps = { visites: () => this._pageVisites(), sellin: () => this._pageSellin(), atteinte: () => this._pageAtteinte(), portefeuille: () => this._pagePortefeuille() };
    const cover = `<section class="pg cover"><div class="logos"><img src="${location.origin}/img/logo-marvesting.png" alt="Marvesting" onerror="this.style.display='none'">${typeof NORTON_SVG === 'string' ? NORTON_SVG : ''}</div>
      <h1>Reporting commercial</h1><p class="sub">${this._esc(this._libellePeriode())}</p><p>${this._esc(Session.nom || '')} · ${date}</p><p class="n">Périmètre ${Session.voitTout() ? 'équipe' : 'personnel'}</p></section>`;
    const pages = [cover, ...b.map((x, i) => this._pageHTML(x[1], corps[x[0]](), i + 2)), this._pageHTML('Synthèse et prochaines actions', this._pageSynthese(), b.length + 2)];
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reporting ESI · ${this._esc(this._libellePeriode())}</title><style>
      @page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1d252c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .pg{width:297mm;height:210mm;padding:14mm 16mm;page-break-after:always;break-after:page;position:relative;overflow:hidden;background:#fff}
      .pg>header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:3px solid #FF6D68;padding-bottom:6px;margin-bottom:10mm}.pg h2{margin:0;font-size:22px;color:#343F48}.pg>header span{font-size:13px;color:#6b757d}
      .pg>footer{position:absolute;left:16mm;right:16mm;bottom:8mm;display:flex;justify-content:space-between;font-size:10px;color:#6b757d}
      .cover{background:#343F48;color:#fff;display:flex;flex-direction:column;justify-content:center}.cover h1{font-size:44px;margin:14mm 0 4mm;border-left:8px solid #FF6D68;padding-left:10mm}.cover .sub{font-size:22px;margin:0 0 8mm 18mm}.cover p{margin-left:18mm}
      .logos{display:flex;align-items:center;gap:14mm;background:#fff;border-radius:12px;padding:8mm 10mm;width:fit-content}.logos img{height:14mm}.logos svg{height:14mm;width:14mm}
      table{border-collapse:collapse;width:100%;font-size:12px;margin:6px 0}th,td{padding:5px 8px;border-bottom:1px solid #e1e5e8;text-align:left}th{background:#f2f4f5;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b757d}
      .k{font-size:15px;margin:0 0 6px}.k b{font-size:26px;color:#343F48}.n{font-size:11px;color:#6b757d}.duo{display:grid;grid-template-columns:1fr 1fr;gap:12mm}h3{font-size:14px;margin:0 0 4px;color:#343F48}svg{max-width:100%;height:auto}
      .ph{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:8px}.ph img{width:100%;height:30mm;object-fit:cover;border-radius:6px}
      .gj{margin:0 0 7mm}.gh{display:flex;gap:10px;align-items:baseline;font-size:13px}.gh span{flex:1;color:#6b757d}.gh strong{font-size:20px}.gt{height:12px;background:#e8ebed;border-radius:8px;margin-top:4px}.gt i{display:block;height:100%;border-radius:8px}
      .syn{font-size:16px;line-height:1.7;padding-left:20px}.an-donut{display:flex;gap:14px;align-items:center}.an-donut svg{width:55mm}.an-leg{list-style:none;padding:0;font-size:12px}.an-leg span{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px}
      </style></head><body>${pages.join('')}</body></html>`);
    w.document.close(); w.focus();
    const lancer = () => { try { w.print(); } catch (e) { /* impression manuelle possible */ } };
    const imgs = [...w.document.images]; let restants = imgs.length;
    if (!restants) setTimeout(lancer, 300); else { const fin = () => { if (--restants <= 0) setTimeout(lancer, 200); }; imgs.forEach(i => (i.complete ? fin() : (i.onload = i.onerror = fin))); setTimeout(lancer, 4000); }
  },

  render() {
    const app = document.getElementById('app'), s = this.state; if (!app) return;
    const entete = `<header class="header-vue"><h1>Analyse et objectifs</h1></header>${NavBar('analyse')}${typeof FusionTabs === 'function' ? FusionTabs.pilotage() : ''}`;
    if (s.chargement) { app.innerHTML = entete + '<p style="padding:16px">Chargement…</p>'; return; }
    if (s.erreur) { app.innerHTML = entete + `<p style="padding:16px">Erreur : ${this._esc(s.erreur)}</p>`; return; }
    const b = this._blocs();
    const onglets = [['vue', 'Vue d’ensemble'], ['rapport', 'Rapport']].map(([k, l]) => `<button class="tab-btn-premium ${s.onglet === k ? 'actif' : ''}" data-onglet="${k}">${l}</button>`).join('');
    const R = this._x(), pg = this._pagesRapport();
    const corps = s.onglet === 'rapport' ? `<section class="an-card"><div class="eyebrow" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6">Reporting · à la demande</div><h2 style="font-size:20px">Exporter un rapport</h2>
        <div class="an-xg"><div><h3>Format</h3><div class="an-seg">${['PDF', 'PPT'].map(f => `<button data-xf="${f}" class="${R.fmt === f ? 'on' : ''}" ${f === 'PPT' ? 'disabled title="PowerPoint : bibliothèque d’export à valider"' : ''}>${f}</button>`).join('')}</div>
          <h3 style="margin-top:14px">Période</h3><div class="an-seg">${this.PERIODES_RAPPORT.map(p => `<button data-xp="${p}" class="${R.per === p ? 'on' : ''}">${p}</button>`).join('')}</div>
          <h3 style="margin-top:14px">Blocs à inclure</h3>${this.BLOCS.map(x => `<label class="an-xb"><input type="checkbox" data-xb="${x[0]}" ${R.blocs.includes(x[0]) ? 'checked' : ''}><span><b>${x[1]}</b><small>${x[2]}</small></span></label>`).join('')}
          <label class="an-xb"><input type="checkbox" data-xph ${R.photos ? 'checked' : ''}><span><b>Inclure les photos des visites</b><small>Photos rattachées aux visites de la période</small></span></label></div>
          <div><h3>Aperçu · ${R.fmt} · ${pg.length} pages</h3><div class="an-xp">${pg.map((t, i) => `<div class="an-pg"><span>${i + 1}</span><i></i><i></i><i style="width:60%"></i><small>${t}</small></div>`).join('')}</div>
            <p style="font-size:12px;opacity:.75;margin-top:10px">Gabarit du refresh : A4 paysage, couleurs Marvesting (anthracite, corail), logos Marvesting et Norton Empower.</p></div></div>
        <button class="btn-primaire" id="an-pdf" style="margin-top:14px">Générer le PDF</button>
        <p style="font-size:11px;opacity:.7;margin-top:8px">La fenêtre d’impression s’ouvre : choisis « Enregistrer au format PDF ». Export PowerPoint : non disponible tant que la bibliothèque n’est pas validée.</p></section>`
      : `<div class="an-grid">${b.canaux}${b.tracker}${b.objectifs}</div>${this._detail()}`;
    app.innerHTML = `<style>
      .an{padding:12px 16px 90px}.an-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.an-card{background:var(--bg-surface,#fff);border:1px solid var(--border-strong,#d5dade);border-radius:12px;padding:12px}
      .an-card h2{font-size:15px;margin:0 0 8px}.an-card svg{width:100%;height:auto}.an-card path,.an-card rect{cursor:pointer;outline-offset:2px}.an-card path:focus-visible,.an-card rect:focus-visible{stroke:#FF6D68;stroke-width:2}
      .an-donut{display:flex;align-items:center;gap:16px;flex-wrap:wrap}.an-donut svg{width:170px;flex:none}.an-leg{display:flex;flex-wrap:wrap;gap:10px 14px;list-style:none;padding:0;margin:8px 0 0;font-size:12px}
      .an-leg span{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}.an-det{margin-top:12px;background:var(--bg-surface,#fff);border:1px solid var(--border-strong,#d5dade);border-radius:12px;padding:12px}
      .an-det ul{list-style:none;padding:0;margin:0}.an-det li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-strong,#e3e6e9);font-size:13px}.an-det li span{opacity:.6}
      .an-xg{display:grid;grid-template-columns:minmax(300px,1.1fr) 1fr;gap:24px;margin-top:14px}@media(max-width:800px){.an-xg{grid-template-columns:1fr}}
      .an-seg{display:flex;gap:6px;flex-wrap:wrap}.an-seg button{padding:7px 14px;border-radius:999px;border:1px solid var(--border-strong,#ccd);background:transparent;color:inherit;font:inherit}.an-seg button.on{background:#FF6D68;border-color:#FF6D68;color:#fff}.an-seg button:disabled{opacity:.45;cursor:not-allowed}
      .an-xb{display:flex;gap:10px;padding:9px 0;border-top:1px solid var(--border-strong,#e3e6e9);cursor:pointer}.an-xb b{display:block;font-size:13px}.an-xb small{opacity:.65}
      .an-xp{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.an-pg{background:var(--bg-warm-white,#f2f4f5);border-radius:10px;padding:8px;aspect-ratio:16/10;position:relative;display:flex;flex-direction:column;gap:5px}.an-pg span{position:absolute;right:8px;top:6px;font-size:10px;font-weight:800;opacity:.5}.an-pg i{display:block;height:6px;background:#c9d0d6;border-radius:3px}.an-pg small{margin-top:auto;font-size:10px}
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
    const R = this._x();
    app.querySelectorAll('[data-xf]').forEach(b => b.onclick = () => { if (!b.disabled) { R.fmt = b.dataset.xf; this.render(); } });
    app.querySelectorAll('[data-xp]').forEach(b => b.onclick = () => { R.per = b.dataset.xp; this.render(); });
    app.querySelectorAll('[data-xb]').forEach(c => c.onchange = () => { R.blocs = c.checked ? [...new Set([...R.blocs, c.dataset.xb])] : R.blocs.filter(x => x !== c.dataset.xb); this.render(); });
    app.querySelectorAll('[data-xph]').forEach(c => c.onchange = () => { R.photos = c.checked; this.render(); });
    const pdf = app.querySelector('#an-pdf'); if (pdf) pdf.onclick = () => this.genererPDF();
  },
};
