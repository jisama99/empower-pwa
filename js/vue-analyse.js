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

  // ── Rapport : un seul objet de données (D) alimente le PDF et le PPTX (prompt 09 : mêmes chiffres) ──
  // Charte : Ardoise 343F48, Rouge signal FF1209, Corail FF6D68, gris clair EEF0F1, gris moyen B8BEC4, texte 424242, Montserrat.
  // Interdits : traits droits (filets, bordures, soulignements), tirets longs et demi-cadratins (valeur absente : « N/A »).
  CH: { ardoise: '343F48', rouge: 'FF1209', corail: 'FF6D68', clair: 'EEF0F1', moyen: 'B8BEC4', texte: '424242' },
  _san(t) { return String(t == null || String(t).trim() === '' ? 'N/A' : t).replace(/\s*[–—]\s*/g, ', '); },
  _init(nom) { return String(nom || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?'; },
  _typeVisite(t) { const m = String(t || '').trim().toLowerCase().replace(/_/g, ' '); return m ? m[0].toUpperCase() + m.slice(1) : ''; },
  _numerique(lignes, i) { return lignes.length > 0 && lignes.every(l => /^[\d\s\u202f\u00a0.,%€]+$/.test(String(l[i]))); },
  _s(n, un, plus) { return n > 1 ? plus : un; },

  _donneesRapport() {
    const s = this.state, r = this._x(), P = window.parseCA || Number, qs = ['Q1', 'Q2', 'Q3', 'Q4'];
    const v = (s.visites || []).filter(x => this._dansPeriode(x.Date || x.Date_Planif)).sort((a, b) => String(b.Date || '').localeCompare(String(a.Date || '')));
    const photos = r.photos ? v.flatMap(x => String(x.Photo_URL || '').split(' | ').map(u => u.trim()).filter(Boolean).slice(0, 1)).slice(0, 3) : [];
    const parCom = s.objectifs.map(o => { const q = qs.map(k => Math.round(P(o[k + '_CA_Realise']) || 0)); return { nom: o.Nom_CDS || this._nom(o.PIN_CDS), q, tot: q.reduce((a, b) => a + b, 0) }; });
    const parQ = qs.map((q, i) => parCom.reduce((t, x) => t + x.q[i], 0)); // somme des cellules affichées : le tableau et l'histogramme concordent
    const tot = c => qs.reduce((t, q) => t + (Number(c['CA_' + q + 'FY27']) || 0), 0);
    const top = s.comptes.filter(c => tot(c) > 0).sort((a, b) => tot(b) - tot(a)).slice(0, 8).map(c => ({ compte: c.Nom_Compte, com: this._nom(c.PIN_CDS_Assigne), ca: Math.round(tot(c)) }));
    const att = this._objectifs().map(x => ({ nom: x.nom, ca: Math.round(x.ca), obj: Math.round(x.obj), pct: Math.round(x.pct) }));
    const sumCa = att.reduce((a, x) => a + x.ca, 0), sumObj = att.reduce((a, x) => a + x.obj, 0);
    const can = this._canaux(), canaux = Object.keys(can).filter(k => can[k].length).map(k => [k, can[k].length]);
    const lead = {}; (s.leads || []).forEach(l => { const k = String(l.STATUT_EMPOWER || l.FLAG_ACTION || 'SAISIE'); lead[k] = (lead[k] || 0) + 1; });
    const deps = new Set(s.comptes.map(c => (window.VueTerritoires && VueTerritoires._dep) ? VueTerritoires._dep(c.Departement, c.Code_Postal) : null).filter(Boolean)).size;
    const t = this._tracker(), act = Object.values(t).reduce((n, g) => n + g.actif.length, 0), non = Object.values(t).reduce((n, g) => n + g.inactif.length, 0);
    const sous = att.filter(x => x.pct < 80).map(x => x.nom);
    return {
      periode: this._libellePeriode(), quarter: s.quarter, date: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
      auteur: Session.nom || 'ESI', perimetre: Session.voitTout() ? 'équipe' : 'personnel', qs,
      visites: { n: v.length, comptes: new Set(v.map(x => x.Nom_Compte)).size, commerciaux: new Set(v.map(x => x.PIN_CDS || x.Nom_CDS)).size,
        lignes: v.slice(0, 6).map(x => [String(x.Date || x.Date_Planif || '').slice(0, 10), window.resolveCDS(x.PIN_CDS || x.Nom_CDS), x.Nom_Compte, this._typeVisite(x.Type_Visite)]), photos },
      sellin: { parQ, total: parQ.reduce((a, b) => a + b, 0), parCom, top },
      atteinte: { lignes: att, ca: sumCa, obj: sumObj, pct: sumObj > 0 ? Math.round(sumCa / sumObj * 100) : 0, ok: att.filter(x => x.pct >= 100).length },
      portefeuille: { canaux, total: canaux.reduce((a, [, n]) => a + n, 0), leads: Object.keys(lead).sort().map(k => [k, lead[k]]), deps },
      synthese: { act, non, sous },
    };
  },

  // Contrôle des totaux recalculés par code (QA 5)
  _qaChiffres(D) {
    const err = [], S = D.sellin, A = D.atteinte, Pf = D.portefeuille;
    // Recalcul depuis les données brutes (tolérance : un arrondi par ligne affichée)
    const P = window.parseCA || Number;
    D.qs.forEach((q, i) => { const brut = this.state.objectifs.reduce((a, o) => a + (P(o[q + '_CA_Realise']) || 0), 0); if (Math.abs(brut - S.parQ[i]) > S.parCom.length / 2 + 1) err.push(`Total ${q} incohérent (${Math.round(brut)} contre ${S.parQ[i]})`); });
    if (S.parCom.reduce((a, x) => a + x.tot, 0) !== S.total) err.push('Total sell-in incohérent');
    if (Pf.total !== this.state.comptes.length) err.push(`Canaux (${Pf.total}) différent du nombre de comptes (${this.state.comptes.length})`);
    A.lignes.forEach(x => { if (x.obj > 0 && Math.abs(Math.round(x.ca / x.obj * 100) - x.pct) > 1) err.push('Pourcentage incohérent : ' + x.nom); });
    return err;
  },

  // Plan des slides (25 maximum) : titre = conclusion, sous-titre rouge, capsule de valeur, notes de l'orateur
  _slides(D) {
    const r = this._x(), f = n => this._fmt(n), sl = [], S = D.sellin, V = D.visites, A = D.atteinte, Pf = D.portefeuille, Y = D.synthese;
    const ajoute = o => sl.push(o);
    if (r.blocs.includes('visites')) {
      ajoute({ kind: 'visites', bloc: 'Visites', titre: V.n ? `${V.n} visite${this._s(V.n, '', 's')} sur la période` : 'Aucune visite sur la période',
        concl: V.n ? `${V.comptes} compte${this._s(V.comptes, '', 's')} rencontré${this._s(V.comptes, '', 's')} par ${V.commerciaux} commercia${V.commerciaux > 1 ? 'ux' : 'l'}` : 'Planifier les visites de la période', capsule: `${V.n} visite${this._s(V.n, '', 's')}`,
        notes: `Message : l'activité terrain de ${D.periode}. Chiffre : ${V.n} visites. Question au public : quels comptes manquent à cette liste ?` });
    }
    if (r.blocs.includes('sellin')) {
      const mx = Math.max(...S.parQ), best = S.total ? D.qs[S.parQ.indexOf(mx)] : null;
      ajoute({ kind: 'sellin', bloc: 'Sell-in', titre: S.total ? `${f(S.total)} € de CA réalisé` : 'Aucun CA réalisé en FY27', concl: best ? `Meilleur quarter : ${best} (${f(mx)} €)` : 'Données de sell-in à renseigner', capsule: `${f(S.total)} €`,
        notes: `Message : le sell-in par quarter et par commercial. Chiffre : ${f(S.total)} € cumulés. Question au public : quel quarter peut encore rattraper l'objectif ?` });
      if (S.top.length) ajoute({ kind: 'top', bloc: 'Sell-in', titre: `${S.top.length} compte${this._s(S.top.length, '', 's')} portent le sell-in`, concl: `Premier compte : ${S.top[0].compte} (${f(S.top[0].ca)} €)`, capsule: `${f(S.top[0].ca)} €`,
        notes: `Message : les comptes qui portent le CA. Chiffre : ${f(S.top[0].ca)} € pour le premier. Question au public : comment reproduire ces commandes ailleurs ?` });
    }
    if (r.blocs.includes('atteinte')) {
      const L = A.lignes, parts = Math.max(1, Math.ceil(L.length / 5));
      for (let i = 0; i < parts; i++) ajoute({ kind: 'atteinte', bloc: 'Atteinte', lignes: L.slice(i * 5, i * 5 + 5), titre: L.length ? `${A.pct} % de l'objectif ${D.quarter}` : `Aucun objectif ${D.quarter}`,
        concl: L.length ? `${A.ok} commercia${A.ok > 1 ? 'ux' : 'l'} à 100 % ou plus sur ${L.length}${parts > 1 ? ` (page ${i + 1}/${parts})` : ''}` : 'Objectifs à saisir', capsule: `${A.pct} %`,
        notes: `Message : où en est chaque commercial face à son objectif. Chiffre : ${A.pct} % en moyenne pondérée. Question au public : qui accompagner en priorité ?` });
    }
    if (r.blocs.includes('portefeuille')) {
      ajoute({ kind: 'portefeuille', bloc: 'Portefeuille', titre: `${Pf.total} compte${this._s(Pf.total, '', 's')} en portefeuille`, concl: `${Pf.deps} département${this._s(Pf.deps, '', 's')} couvert${this._s(Pf.deps, '', 's')} sur 96`, capsule: `${Pf.deps} / 96`,
        notes: `Message : la répartition par canal, le pipeline et la couverture. Chiffre : ${Pf.deps} départements. Question au public : quels départements ouvrir en premier ?` });
    }
    ajoute({ kind: 'synthese', bloc: 'Synthèse', titre: `${Y.act} compte${this._s(Y.act, '', 's')} Empower activé${this._s(Y.act, '', 's')}`, concl: Y.non ? `${Y.non} sur ${Y.act + Y.non} à relancer pour une première commande` : 'Aucune relance de première commande',
      capsule: `${Y.act} / ${Y.act + Y.non}`, notes: `Message : ce qui est activé et ce qui reste à faire. Chiffre : ${Y.act} activés. Question au public : quelle action décide-t-on aujourd'hui ?`,
      lignes: [`${Y.act} compte${this._s(Y.act, '', 's')} Empower activé${this._s(Y.act, '', 's')} (première commande passée), ${Y.non} non activé${this._s(Y.non, '', 's')}.`,
        Y.non ? `Prochaine action : relancer ${Y.non > 1 ? 'les ' + Y.non + ' comptes Empower onboardés' : 'le compte Empower onboardé'} sans première commande.` : 'Aucun compte Empower en attente de première commande.',
        Y.sous.length ? `Objectif sous 80 % : ${Y.sous.join(', ')}. Point d'accompagnement à prévoir.` : 'Aucun commercial sous 80 % de son objectif.'] });
    return sl.slice(0, 24);
  },

  // Contrôle qualité automatique : caractères interdits, lignes droites, tailles de police
  _qaTextes(textes) { return textes.filter(t => /[–—]/.test(t)).map(t => 'Tiret interdit dans : ' + t.slice(0, 50)); },
  _qaHtml(html) {
    const e = [];
    html = html.replace(/<div class="logos">[\s\S]*?<\/div>/, ''); // les logos de marque (tracés du logo Norton) ne sont pas du décor
    if (/[–—]/.test(html)) e.push('Tiret long ou demi-cadratin dans le HTML');
    if (/(?<!box-sizing:)border(?!-radius|-spacing|-collapse:separate)/i.test(html)) e.push('Bordure dans le CSS');
    if (/<hr|<line|<polyline|text-decoration|underline|outline(?!-offset)/i.test(html)) e.push('Ligne droite ou soulignement dans le HTML');
    return e;
  },

  // ── PPTX (pptxgenjs, chargé à la demande, version épinglée) : 16:9, 10 x 5,625 in ──
  PPTX_URL: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  async _chargerPptx() {
    if (window.PptxGenJS) return;
    await new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = this.PPTX_URL; s.onload = res;
      s.onerror = () => rej(new Error('Bibliothèque PowerPoint indisponible (réseau)')); document.head.appendChild(s);
    });
    if (!window.PptxGenJS) throw new Error('Bibliothèque PowerPoint indisponible');
  },
  async _imageData(url) {
    try { const r = await fetch(url); if (!r.ok) return null; const b = await r.blob();
      return await new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(null); f.readAsDataURL(b); }); } catch (e) { return null; }
  },
  async genererPPT() {
    const r = this._x(); if (!this.BLOCS.some(x => r.blocs.includes(x[0]))) { if (window.Toast) Toast.afficher('Coche au moins un bloc', 'erreur'); return; }
    try { await this._chargerPptx(); } catch (e) { if (window.Toast) Toast.afficher(e.message, 'erreur'); return; }
    const C = this.CH, FONT = 'Montserrat', D = this._donneesRapport(), slides = this._slides(D), f = n => this._fmt(n), z = t => this._san(t);
    const err = this._qaChiffres(D), textes = [];
    const pptx = new PptxGenJS(); pptx.layout = 'LAYOUT_16x9'; pptx.title = 'Reporting ESI'; pptx.author = D.auteur;
    const T = (sl, t, o) => { t = z(t); textes.push(t); if ((o.fontSize || 12) < 12) err.push('Police sous 12 pt : ' + t.slice(0, 30)); sl.addText(t, { fontFace: FONT, color: C.texte, margin: 0, valign: 'middle', ...o }); };
    const F = (sl, type, o) => sl.addShape(type, { line: { type: 'none' }, ...o });
    const cellule = (t, o = {}) => { t = z(t); textes.push(t); return { text: t, options: { fontFace: FONT, fontSize: 12, color: C.texte, border: { type: 'none' }, margin: [0.03, 0.08, 0.03, 0.08], ...o } }; };
    const tableau = (sl, tete, lignes, o) => {
      const dr = tete.map((_, i) => this._numerique(lignes, i) ? 'right' : 'left');
      const rows = [tete.map((t, i) => cellule(t, { bold: true, color: 'FFFFFF', fill: { color: C.ardoise }, align: dr[i] })),
        ...lignes.map((l, k) => l.map((t, i) => cellule(t, { fill: { color: k % 2 ? 'FFFFFF' : C.clair }, align: dr[i] })))];
      sl.addTable(rows, { fontFace: FONT, rowH: 0.34, ...o });
    };
    const logo = await this._imageData(location.origin + '/img/logo-marvesting.png');
    // Couverture
    const c = pptx.addSlide(); c.background = { color: C.ardoise };
    if (logo) { F(c, pptx.ShapeType.roundRect, { x: 0.6, y: 0.6, w: 2.6, h: 1.0, fill: { color: 'FFFFFF' }, rectRadius: 0.15 }); c.addImage({ data: logo, x: 0.75, y: 0.7, w: 2.3, h: 0.8, sizing: { type: 'contain', w: 2.3, h: 0.8 } }); }
    F(c, pptx.ShapeType.roundRect, { x: 0.6, y: 2.2, w: 1.0, h: 0.5, fill: { color: C.rouge }, rectRadius: 0.25 });
    T(c, 'ESI', { x: 0.6, y: 2.2, w: 1.0, h: 0.5, fontSize: 14, bold: true, color: 'FFFFFF', align: 'center' });
    T(c, 'Reporting commercial', { x: 0.6, y: 2.85, w: 8.8, h: 0.8, fontSize: 40, bold: true, color: 'FFFFFF' });
    T(c, D.periode, { x: 0.6, y: 3.65, w: 8.8, h: 0.5, fontSize: 20, color: C.corail });
    T(c, `${D.auteur} · ${D.date} · périmètre ${D.perimetre}`, { x: 0.6, y: 4.3, w: 8.8, h: 0.4, fontSize: 14, color: 'FFFFFF' });
    c.addNotes('Message : le point de la période. Chiffre : voir slides suivantes. Question au public : que veut-on décider aujourd\'hui ?');
    const total = slides.length + 1; let chap = 0, prev = null;
    for (let i = 0; i < slides.length; i++) {
      const d = slides[i], sl = pptx.addSlide(); sl.background = { color: 'FFFFFF' };
      if (d.bloc !== prev) { chap++; prev = d.bloc; }
      F(sl, pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 1.0, fill: { color: C.ardoise } });
      F(sl, pptx.ShapeType.roundRect, { x: 0.35, y: 0.25, w: 0.5, h: 0.5, fill: { color: C.rouge }, rectRadius: 0.12, rotate: -6 });
      T(sl, String(chap), { x: 0.35, y: 0.25, w: 0.5, h: 0.5, fontSize: 16, bold: true, color: 'FFFFFF', align: 'center' });
      T(sl, d.titre, { x: 1.05, y: 0.1, w: 6.7, h: 0.52, fontSize: 24, bold: true, color: 'FFFFFF', fit: 'shrink' });
      T(sl, d.concl.length > 52 ? d.concl.slice(0, 51) + '.' : d.concl, { x: 1.05, y: 0.6, w: 6.7, h: 0.32, fontSize: 14, bold: true, color: C.rouge });
      F(sl, pptx.ShapeType.roundRect, { x: 7.85, y: 0.27, w: 1.8, h: 0.46, fill: { color: 'FFFFFF' }, rectRadius: 0.23 });
      T(sl, d.capsule, { x: 7.85, y: 0.27, w: 1.8, h: 0.46, fontSize: 14, bold: true, color: C.ardoise, align: 'center' });
      T(sl, `${D.auteur} · Norton × ISM · FY27`, { x: 0.5, y: 5.2, w: 6, h: 0.3, fontSize: 12, color: C.texte });
      T(sl, `${i + 2} / ${total}`, { x: 8.4, y: 5.2, w: 1.1, h: 0.3, fontSize: 12, color: C.texte, align: 'right' });
      if (d.kind === 'visites') {
        T(sl, String(D.visites.n), { x: 0.5, y: 1.4, w: 2.0, h: 0.9, fontSize: 48, bold: true, color: C.rouge });
        T(sl, `visite${this._s(D.visites.n, '', 's')} sur la période`, { x: 0.5, y: 2.3, w: 2.0, h: 0.6, fontSize: 12, color: C.texte, valign: 'top' });
        if (D.visites.lignes.length) tableau(sl, ['Date', 'Commercial', 'Compte', 'Type'], D.visites.lignes, { x: 2.7, y: 1.3, w: 6.9, colW: [1.1, 1.6, 2.7, 1.5] });
        else T(sl, 'Aucune visite enregistrée sur la période.', { x: 2.7, y: 1.4, w: 6.9, h: 0.5, fontSize: 14 });
        for (let k = 0; k < D.visites.photos.length; k++) { const p = await this._imageData(D.visites.photos[k]); if (p) sl.addImage({ data: p, x: 2.7 + k * 2.35, y: 3.95, w: 2.2, h: 1.1, sizing: { type: 'cover', w: 2.2, h: 1.1 } }); }
      } else if (d.kind === 'sellin') {
        const S = D.sellin;
        sl.addChart(pptx.charts.BAR, [{ name: 'CA réalisé (€)', labels: D.qs, values: S.parQ }], { x: 0.4, y: 1.25, w: 4.5, h: 3.8, barDir: 'col', chartColors: [C.rouge], showValue: true, dataLabelFontSize: 12, dataLabelFontFace: FONT, dataLabelColor: C.texte, dataLabelFormatCode: '#,##0',
          catAxisLabelFontSize: 12, catAxisLabelFontFace: FONT, catAxisLabelColor: C.texte, catAxisLineShow: false, valAxisHidden: true, valAxisLineShow: false, valGridLine: { style: 'none' }, catGridLine: { style: 'none' }, showLegend: false, barGapWidthPct: 60 });
        tableau(sl, ['Commercial', ...D.qs], S.parCom.slice(0, 6).map(x => [x.nom, ...x.q.map(f)]), { x: 5.1, y: 1.4, w: 4.5, colW: [1.3, 0.8, 0.8, 0.8, 0.8] });
      } else if (d.kind === 'top') {
        tableau(sl, ['Compte', 'Commercial', 'CA'], D.sellin.top.map(x => [x.compte, x.com, f(x.ca) + ' €']), { x: 0.5, y: 1.35, w: 9.0, colW: [4.2, 2.8, 2.0], rowH: 0.4 });
      } else if (d.kind === 'atteinte') {
        const pal = [C.ardoise, C.rouge, C.corail, C.moyen, C.ardoise];
        d.lignes.forEach((x, k) => {
          const y = 1.3 + k * 0.75;
          F(sl, pptx.ShapeType.ellipse, { x: 0.5, y, w: 0.55, h: 0.55, fill: { color: pal[k % 5] } });
          T(sl, this._init(x.nom), { x: 0.5, y, w: 0.55, h: 0.55, fontSize: 12, bold: true, color: 'FFFFFF', align: 'center' });
          T(sl, x.nom, { x: 1.25, y: y - 0.02, w: 3.2, h: 0.3, fontSize: 14, bold: true, color: C.ardoise });
          T(sl, `${f(x.ca)} € sur ${f(x.obj)} €`, { x: 4.5, y: y - 0.02, w: 3.2, h: 0.3, fontSize: 12 });
          F(sl, pptx.ShapeType.roundRect, { x: 1.25, y: y + 0.36, w: 6.5, h: 0.16, fill: { color: C.clair }, rectRadius: 0.08 });
          F(sl, pptx.ShapeType.roundRect, { x: 1.25, y: y + 0.36, w: Math.max(0.2, 6.5 * Math.min(1, x.pct / 100)), h: 0.16, fill: { color: C.rouge }, rectRadius: 0.08 });
          T(sl, x.pct + ' %', { x: 7.9, y: y - 0.05, w: 1.6, h: 0.6, fontSize: 28, bold: true, color: C.rouge, align: 'right' });
        });
        if (!d.lignes.length) T(sl, 'Aucun objectif pour ce trimestre.', { x: 0.5, y: 1.4, w: 8, h: 0.5, fontSize: 14 });
      } else if (d.kind === 'portefeuille') {
        const Pf = D.portefeuille, pal = [C.ardoise, C.rouge, C.corail, C.moyen];
        if (Pf.canaux.length) sl.addChart(pptx.charts.DOUGHNUT, [{ name: 'Comptes', labels: Pf.canaux.map(x => x[0]), values: Pf.canaux.map(x => x[1]) }], { x: 0.4, y: 1.25, w: 4.5, h: 3.8, holeSize: 55, chartColors: pal.slice(0, Pf.canaux.length), showLegend: true, legendPos: 'b', legendFontSize: 12, legendFontFace: FONT, legendColor: C.texte, showValue: true, showPercent: false, dataLabelFontSize: 12, dataLabelFontFace: FONT, dataLabelColor: 'FFFFFF', dataBorder: { pt: 0, color: 'FFFFFF' } });
        T(sl, String(Pf.deps), { x: 5.2, y: 1.3, w: 1.6, h: 0.9, fontSize: 48, bold: true, color: C.rouge });
        T(sl, `département${this._s(Pf.deps, '', 's')} avec au moins un compte, sur 96`, { x: 6.9, y: 1.3, w: 2.7, h: 0.9, fontSize: 12 });
        if (Pf.leads.length) tableau(sl, ['Pipeline : statut', 'Leads'], Pf.leads.slice(0, 5), { x: 5.2, y: 2.5, w: 4.4, colW: [3.2, 1.2] });
        else T(sl, 'Aucun lead dans le pipeline.', { x: 5.2, y: 2.6, w: 4.4, h: 0.4, fontSize: 14 });
      } else if (d.kind === 'synthese') {
        d.lignes.forEach((l, k) => {
          F(sl, pptx.ShapeType.roundRect, { x: 0.5, y: 1.3 + k * 1.25, w: 9.0, h: 1.05, fill: { color: C.clair }, rectRadius: 0.15 });
          F(sl, pptx.ShapeType.ellipse, { x: 0.7, y: 1.55 + k * 1.25, w: 0.55, h: 0.55, fill: { color: k === 1 ? C.rouge : C.ardoise } });
          T(sl, String(k + 1), { x: 0.7, y: 1.55 + k * 1.25, w: 0.55, h: 0.55, fontSize: 14, bold: true, color: 'FFFFFF', align: 'center' });
          T(sl, l, { x: 1.5, y: 1.35 + k * 1.25, w: 7.8, h: 0.95, fontSize: 14 });
        });
      }
      sl.addNotes(z(d.notes)); textes.push(d.notes);
    }
    err.push(...this._qaTextes(textes));
    if (err.length) { if (window.Toast) Toast.afficher('Contrôle qualité : ' + err[0], 'erreur'); console.error('QA rapport', err); return; }
    try {
      const blob = await this._finaliserPptx(await pptx.write({ outputType: 'arraybuffer' }));
      this._telecharger(blob, 'Reporting-ESI-' + new Date().toISOString().slice(0, 10) + '.pptx');
      if (window.Toast) Toast.afficher('PowerPoint généré', 'succes');
    } catch (e) { if (window.Toast) Toast.afficher('Échec de la génération PowerPoint : ' + e.message, 'erreur'); console.error('QA rapport', e); }
  },

  // Passe finale sur le XML du PPTX : supprime tout contour (aplats seuls) puis vérifie lignes, connecteurs, tirets, polices < 12 pt
  async _finaliserPptx(buf) {
    const zip = await JSZip.loadAsync(buf), err = [];
    for (const nom of Object.keys(zip.files).filter(n => /^ppt\/(slides|charts|notesSlides|slideMasters|slideLayouts|notesMasters|theme)\/[^/]+\.xml$/.test(n))) {
      let x = (await zip.file(nom).async('string')).replace(/<a:buChar char="[\u2013\u2014]"\/>/g, '<a:buChar char="\u2022"/>');
      x = x.replace(/<a:ln\b[^>]*\/>/g, '<a:ln><a:noFill/></a:ln>').replace(/<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g, '<a:ln><a:noFill/></a:ln>');
      if (/[\u2013\u2014]/.test(x)) err.push('Tiret interdit : ' + nom);
      if (/<p:cxnSp|prst="line"|<c:majorGridlines|<c:minorGridlines/.test(x)) err.push('Ligne droite : ' + nom);
      if (/\su="(?!none)/.test(x)) err.push('Soulignement : ' + nom);
      if (/\ssz="(\d{3,4})"/.test(x) && [...x.matchAll(/\ssz="(\d+)"/g)].some(m => Number(m[1]) < 1200)) err.push('Police sous 12 pt : ' + nom);
      zip.file(nom, x);
    }
    if (err.length) throw new Error('Contrôle qualité PPTX : ' + err[0]);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  },
  _telecharger(blob, nom) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  // ── PDF (HTML imprimé, A4 paysage) : mêmes données et mêmes slides que le PPTX ──
  _htmlRapport(D, slides) {
    const C = this.CH, e = t => this._esc(this._san(t)), f = n => this._fmt(n);
    const tab = (tete, lignes) => { const dr = tete.map((_, i) => this._numerique(lignes, i) ? 'r' : ''); return `<table><thead><tr>${tete.map((t, i) => `<th class="${dr[i]}">${e(t)}</th>`).join('')}</tr></thead><tbody>${lignes.map(l => `<tr>${l.map((t, i) => `<td class="${dr[i]}">${e(t)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; };
    const pal = ['#' + C.ardoise, '#' + C.rouge, '#' + C.corail, '#' + C.moyen];
    const corps = d => {
      if (d.kind === 'visites') return `<div class="cols"><div class="hero"><b>${D.visites.n}</b><span>visite${this._s(D.visites.n, '', 's')} sur la période</span></div><div class="grow">${D.visites.lignes.length ? tab(['Date', 'Commercial', 'Compte', 'Type'], D.visites.lignes) : '<p>Aucune visite enregistrée sur la période.</p>'}
        ${D.visites.photos.length ? `<div class="ph">${D.visites.photos.map(u => `<img src="${this._esc(u)}" alt="Photo de visite" onerror="this.style.display='none'">`).join('')}</div>` : ''}</div></div>`;
      if (d.kind === 'sellin') { const S = D.sellin, mx = Math.max(1, ...S.parQ);
        return `<div class="cols"><div class="bars">${S.parQ.map((v, i) => `<div class="b"><em>${f(v)}</em><i style="height:${Math.max(2, v / mx * 52)}mm"></i><span>${D.qs[i]}</span></div>`).join('')}</div><div class="grow">${tab(['Commercial', ...D.qs], S.parCom.slice(0, 6).map(x => [x.nom, ...x.q.map(f)]))}</div></div>`; }
      if (d.kind === 'top') return tab(['Compte', 'Commercial', 'CA'], D.sellin.top.map(x => [x.compte, x.com, f(x.ca) + ' €']));
      if (d.kind === 'atteinte') return d.lignes.length ? d.lignes.map((x, k) => `<div class="gj"><span class="ci" style="background:${pal[k % 4]}">${e(this._init(x.nom))}</span><div class="grow"><div class="gh"><b>${e(x.nom)}</b><span>${f(x.ca)} € sur ${f(x.obj)} €</span><strong>${x.pct} %</strong></div><div class="gt"><i style="width:${Math.min(100, x.pct)}%"></i></div></div></div>`).join('') : '<p>Aucun objectif pour ce trimestre.</p>';
      if (d.kind === 'portefeuille') { const Pf = D.portefeuille; let a = 0; const seg = Pf.canaux.map(([, n], i) => { const p = n / (Pf.total || 1) * 100, s = `${pal[i % 4]} ${a}% ${a + p}%`; a += p; return s; }).join(',');
        return `<div class="cols"><div class="don"><div class="ring" style="background:conic-gradient(${seg || '#' + C.clair + ' 0 100%'})"><span>${Pf.total}</span></div><ul>${Pf.canaux.map(([k, n], i) => `<li><i style="background:${pal[i % 4]}"></i>${e(k)} <b>${n}</b></li>`).join('')}</ul></div>
          <div class="grow"><div class="hero"><b>${Pf.deps}</b><span>département${this._s(Pf.deps, '', 's')} avec au moins un compte, sur 96</span></div>${Pf.leads.length ? tab(['Pipeline : statut', 'Leads'], Pf.leads.slice(0, 5)) : '<p>Aucun lead dans le pipeline.</p>'}</div></div>`; }
      return d.lignes.map((l, k) => `<div class="pan"><span class="ci" style="background:${k === 1 ? '#' + C.rouge : '#' + C.ardoise}">${k + 1}</span><p>${e(l)}</p></div>`).join('');
    };
    const total = slides.length + 1;
    const cover = `<section class="pg cover"><div class="logos"><img src="${location.origin}/img/logo-marvesting.png" alt="Marvesting" onerror="this.style.display='none'">${typeof NORTON_SVG === 'string' ? NORTON_SVG : ''}</div><div class="tag">ESI</div><h1>Reporting commercial</h1><p class="sub">${e(D.periode)}</p><p>${e(D.auteur)} · ${e(D.date)} · périmètre ${e(D.perimetre)}</p></section>`;
    let chap = 0, prev = null;
    const pages = slides.map((d, i) => { if (d.bloc !== prev) { chap++; prev = d.bloc; }
      return `<section class="pg"><header><span class="bd">${chap}</span><div class="grow"><h2>${e(d.titre)}</h2><p>${e(d.concl)}</p></div><span class="cap">${e(d.capsule)}</span></header><div class="body">${corps(d)}</div><footer><span>${e(D.auteur)} · Norton × ISM · FY27</span><span>${i + 2} / ${total}</span></footer></section>`; });
    const css = `@page{size:A4 landscape;margin:0}*{box-sizing:border-box}body{margin:0;font-family:'Montserrat','Segoe UI',system-ui,sans-serif;color:#${C.texte};-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .pg{width:297mm;height:210mm;page-break-after:always;break-after:page;position:relative;overflow:hidden;background:#fff}.grow{flex:1;min-width:0}
      .pg>header{display:flex;align-items:center;gap:6mm;background:#${C.ardoise};color:#fff;height:30mm;padding:0 14mm}.pg h2{margin:0;font-size:24px;font-weight:700}.pg>header p{margin:3px 0 0;font-size:14px;font-weight:700;color:#${C.rouge}}
      .bd{display:flex;align-items:center;justify-content:center;width:13mm;height:13mm;border-radius:4mm;background:#${C.rouge};font-weight:700;font-size:18px;transform:rotate(-6deg)}.cap{background:#fff;color:#${C.ardoise};border-radius:99px;padding:3mm 6mm;font-weight:700;font-size:15px;white-space:nowrap}
      .body{padding:10mm 14mm}.pg>footer{position:absolute;left:14mm;right:14mm;bottom:7mm;display:flex;justify-content:space-between;font-size:12px}
      .cover{background:#${C.ardoise};color:#fff;padding:20mm 22mm}.cover h1{font-size:44px;margin:14mm 0 4mm}.cover .sub{font-size:22px;color:#${C.corail};margin:0 0 8mm}.cover p{font-size:15px}.tag{display:inline-block;background:#${C.rouge};border-radius:99px;padding:3mm 8mm;font-weight:700;margin-top:16mm}
      .logos{display:flex;align-items:center;gap:12mm;color:#${C.ardoise};background:#fff;border-radius:5mm;padding:6mm 9mm;width:fit-content}.logos img{height:14mm}.logos svg{height:14mm;width:14mm}
      .cols{display:flex;gap:10mm;align-items:flex-start}.hero{min-width:46mm}.hero b{display:block;font-size:56px;line-height:1;color:#${C.rouge}}.hero span{font-size:12px}
      table{border-collapse:separate;border-spacing:0;width:100%;font-size:12px}th,td{padding:2.2mm 3mm;text-align:left}th{background:#${C.ardoise};color:#fff}td.r,th.r{text-align:right}tbody tr:nth-child(odd) td{background:#${C.clair}}
      th:first-child{border-radius:3mm 0 0 3mm}th:last-child{border-radius:0 3mm 3mm 0}
      .ph{display:flex;gap:4mm;margin-top:5mm}.ph img{width:60mm;height:30mm;object-fit:cover;border-radius:4mm}
      .bars{display:flex;gap:6mm;align-items:flex-end;height:70mm;min-width:95mm}.b{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;width:20mm;font-size:12px}.b i{display:block;width:100%;background:#${C.rouge};border-radius:3mm 3mm 0 0}.b em{font-style:normal;margin-bottom:1mm}.b span{margin-top:2mm}
      .gj{display:flex;gap:5mm;align-items:center;margin:0 0 5.5mm}.ci{display:flex;align-items:center;justify-content:center;flex:none;width:12mm;height:12mm;border-radius:50%;color:#fff;font-weight:700;font-size:13px}
      .gh{display:flex;gap:4mm;align-items:baseline;font-size:14px}.gh span{flex:1;font-size:12px}.gh strong{font-size:26px;color:#${C.rouge}}.gt{height:4mm;background:#${C.clair};border-radius:99px;margin-top:1mm}.gt i{display:block;height:100%;background:#${C.rouge};border-radius:99px}
      .don{display:flex;flex-direction:column;align-items:center;gap:4mm;min-width:70mm}.ring{width:52mm;height:52mm;border-radius:50%;display:flex;align-items:center;justify-content:center}.ring span{display:flex;align-items:center;justify-content:center;width:28mm;height:28mm;border-radius:50%;background:#fff;font-size:26px;font-weight:700}
      .don ul{list-style:none;padding:0;margin:0;font-size:12px}.don li i{display:inline-block;width:3mm;height:3mm;border-radius:50%;margin-right:2mm}
      .pan{display:flex;align-items:center;gap:6mm;background:#${C.clair};border-radius:6mm;padding:5mm 7mm;margin-bottom:5mm}.pan p{margin:0;font-size:15px}`;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reporting ESI : ${this._esc(D.periode)}</title><style>${css}</style></head><body>${cover}${pages.join('')}</body></html>`;
  },

  genererPDF() {
    const r = this._x(); if (!this.BLOCS.some(x => r.blocs.includes(x[0]))) { if (window.Toast) Toast.afficher('Coche au moins un bloc', 'erreur'); return; }
    const D = this._donneesRapport(), slides = this._slides(D), html = this._htmlRapport(D, slides);
    const err = [...this._qaChiffres(D), ...this._qaHtml(html)];
    if (err.length) { if (window.Toast) Toast.afficher('Contrôle qualité : ' + err[0], 'erreur'); console.error('QA rapport', err); return; }
    const w = window.open('', '_blank'); if (!w) { if (window.Toast) Toast.afficher('Fenêtre bloquée : autorise les pop-ups', 'erreur'); return; }
    w.document.write(html); w.document.close(); w.focus();
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
        <div class="an-xg"><div><h3>Format</h3><div class="an-seg">${['PDF', 'PPT'].map(f => `<button data-xf="${f}" class="${R.fmt === f ? 'on' : ''}">${f}</button>`).join('')}</div>
          <h3 style="margin-top:14px">Période</h3><div class="an-seg">${this.PERIODES_RAPPORT.map(p => `<button data-xp="${p}" class="${R.per === p ? 'on' : ''}">${p}</button>`).join('')}</div>
          <h3 style="margin-top:14px">Blocs à inclure</h3>${this.BLOCS.map(x => `<label class="an-xb"><input type="checkbox" data-xb="${x[0]}" ${R.blocs.includes(x[0]) ? 'checked' : ''}><span><b>${x[1]}</b><small>${x[2]}</small></span></label>`).join('')}
          <label class="an-xb"><input type="checkbox" data-xph ${R.photos ? 'checked' : ''}><span><b>Inclure les photos des visites</b><small>Photos rattachées aux visites de la période</small></span></label></div>
          <div><h3>Aperçu · ${R.fmt} · ${pg.length} pages</h3><div class="an-xp">${pg.map((t, i) => `<div class="an-pg"><span>${i + 1}</span><i></i><i></i><i style="width:60%"></i><small>${t}</small></div>`).join('')}</div>
            <p style="font-size:12px;opacity:.75;margin-top:10px">Gabarit du refresh : paysage (A4 en PDF, 16:9 en PPT), couleurs Marvesting (anthracite, corail), logos Marvesting et Norton Empower.</p></div></div>
        <button class="btn-primaire" id="an-pdf" style="margin-top:14px">Générer le ${R.fmt}</button>
        <p style="font-size:11px;opacity:.7;margin-top:8px">PDF : la fenêtre d’impression s’ouvre, choisis « Enregistrer au format PDF ». PPT : fichier .pptx 16:9 téléchargé (bibliothèque pptxgenjs 3.12.0, chargée à la demande).</p></section>`
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
    const pdf = app.querySelector('#an-pdf'); if (pdf) pdf.onclick = () => (this._x().fmt === 'PPT' ? this.genererPPT() : this.genererPDF());
  },
};
