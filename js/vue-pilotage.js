// ═══════════════════════════════════════
//  vue-pilotage.js — Refresh ESI : écran « Pilotage » (Où agir aujourd'hui ?)
//  Structure de la maquette V1 Cockpit / Figma : fil d'Ariane, filtres de contexte, KPI cliquables
//  (chacun mène à la liste qui l'explique), file « Actions prioritaires » et « Synthèse d'équipe ».
//  Données réelles, mêmes sources et mêmes règles que Phoning, À contacter et Vue équipe ; lecture seule.
//  Un CDS ne voit que son périmètre ; le CA/objectif est masqué pour le Channel manager (comme la Vue équipe).
// ═══════════════════════════════════════
window.VuePilotage = {
  state: null,

  _esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  _norm(v) { return String(v || '').trim().toUpperCase(); },
  _fmt(d) { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : 'n.c.'; },

  async init() {
    this.state = { chargement: true, erreur: null, d: null, vue: null };
    this.render();
    try {
      const L = t => SheetsAPI.lire('EMPOWER_MDB', t, { nocache: true });
      const [leads, appels, visites, objectifs, params, comptes] = await Promise.all([
        L('LEADS'), L('PHONING'), L('VISITES'), L('OBJECTIFS_PRIMES'), SheetsAPI.lire('EMPOWER_MDB', 'PARAMS'), L('COMPTES'),
      ]);
      this._raw = { comptes, visites, appels, objectifs, params };
      // Le trimestre actif s'applique à l'ouverture de l'écran ; le choix manuel ensuite est conservé.
      if (!this._qInit) { const qa = (params || []).find(p => p.Parametre === 'QuarterActif'); if (qa && qa.Valeur) FilterState.set({ quarter: qa.Valeur }); this._qInit = true; }
      if (window.AContacter) { try { await AContacter.charger(); } catch (e) {} }
      this.state.d = this._calculer({ leads, appels, visites, objectifs, params });
      this.state.chargement = false;
    } catch (e) { this.state.chargement = false; this.state.erreur = e.message || String(e); }
    this.state.vue = this.state.vue || (Session.voitTout() ? 'manager' : 'commercial');
    this.state.maj = new Date();
    this.render();
  },

  _calculer({ leads, appels, visites, objectifs, params }) {
    const norm = this._norm;
    const voitTout = Session.voitTout();
    const mien = pin => voitTout || Number(pin) === Number(Session.pin);
    const auj = new Date().toISOString().slice(0, 10);
    const paramMap = Object.fromEntries((params || []).map(p => [p.Parametre, p.Valeur]));
    const quarter = paramMap.QuarterActif || 'Q1';

    // Périmètre « pipeline » : mêmes exclusions que la Vue équipe (imports base, hors-base, supprimés).
    const pipe = (leads || []).filter(p => {
      const src = norm(p.Source_Import);
      return norm(p.Flag_traite) !== 'DELETED' && !src.includes('FLAVIE') && src !== 'BASE_PROSPECTS_RELANCER' && src !== 'ESI_VISITE_FROID' && mien(p.PIN_CDS_Assigne);
    });
    const ouverts = pipe.filter(p => !['ARCHIVE', 'INTEGRE'].includes(norm(p.STATUT_EMPOWER)));
    const integres = pipe.filter(p => norm(p.STATUT_EMPOWER) === 'INTEGRE');
    const sansAction = ouverts.filter(p => !p.Date_prochaine_action);
    const echus = ouverts.filter(p => p.Date_prochaine_action && String(p.Date_prochaine_action).slice(0, 10) <= auj)
      .sort((a, b) => String(a.Date_prochaine_action).localeCompare(String(b.Date_prochaine_action)));
    const echus48 = echus.filter(p => (Date.now() - new Date(String(p.Date_prochaine_action).slice(0, 10)).getTime()) > 172800000);

    const dansSem = d => { try { return FiscalWeeks.dansSemaineCalendaire(d); } catch (e) { return false; } };
    const v7 = (visites || []).filter(v => !v.deleted && mien(v.PIN_CDS) && dansSem(v.Date));
    const a7 = (appels || []).filter(a => mien(a.PIN_CDS) && dansSem(a.Date) && (typeof estAppelRealise !== 'function' || estAppelRealise(a)));

    const ac = window.AContacter ? AContacter.visibles() : [];

    // CA / objectif du trimestre actif (absent pour le Channel manager)
    let ca = null;
    if (!(Session.estChannel && Session.estChannel())) {
      const obs = (objectifs || []).filter(o => mien(o.PIN_CDS));
      const sCa = obs.reduce((t, o) => t + Number(o[`${quarter}_CA_Realise`] || 0), 0);
      const sObj = obs.reduce((t, o) => t + Number(o[`${quarter}_Obj_Revise`] || o[`${quarter}_Obj_Initial`] || 0), 0);
      ca = { ca: sCa, obj: sObj, pct: sObj > 0 ? Math.round(sCa / sObj * 100) : null, quarter };
    }

    // Synthèse d'équipe : charge par commercial (descriptive, sans classement)
    const equipe = voitTout ? (objectifs || []).map(o => {
      const pin = Number(o.PIN_CDS);
      const mesOuv = ouverts.filter(p => Number(p.PIN_CDS_Assigne) === pin);
      const mesEch = echus.filter(p => Number(p.PIN_CDS_Assigne) === pin);
      return {
        pin, nom: o.Nom_CDS || ('PIN ' + pin), ouverts: mesOuv.length, echus: mesEch.length,
        acontacter: ac.filter(r => Number(r.PIN_CDS_Assigne) === pin).length,
        act: v7.filter(v => Number(v.PIN_CDS) === pin).length + a7.filter(a => Number(a.PIN_CDS) === pin).length,
      };
    }) : [];

    return { ouverts, integres, sansAction, echus, echus48, v7, a7, ac, ca, equipe, quarter, auj };
  },

  // KPI : libellé, valeur, précision, destination (la liste qui explique la valeur)
  _kpis(d) {
    const k = [
      { l: 'Leads ouverts', v: d.ouverts.length, s: `${d.sansAction.length} sans prochaine action`, to: '#/empower-tracker' },
      { l: 'Rappels échus', v: d.echus.length, s: d.echus.length ? `dont ${d.echus48.length} depuis plus de 48 h` : 'aucun en retard', to: '#/phoning', alerte: d.echus.length > 0 },
      { l: 'Activités · 7 jours', v: d.v7.length + d.a7.length, s: `${d.a7.length} appels · ${d.v7.length} visites`, to: '#/visites' },
      { l: 'À contacter', v: d.ac.length, s: 'comptes à relancer', to: '#/a-contacter' },
      { l: 'Empower activés', v: d.integres.length, s: 'leads intégrés', to: '#/empower-tracker' },
    ];
    if (d.ca) k.push({ l: `Sell-in / objectif ${d.quarter}`, v: d.ca.pct == null ? 'n.c.' : d.ca.pct + ' %', s: d.ca.obj ? `${Math.round(d.ca.ca).toLocaleString('fr-FR')} € sur ${Math.round(d.ca.obj).toLocaleString('fr-FR')} €` : 'objectif non renseigné', to: '#/objectifs' });
    return k;
  },

  // Actions prioritaires : règles lisibles (rappel échu, puis compte à contacter), pas de score opaque
  _actions(d) {
    const E = this._esc;
    const rap = d.echus.slice(0, 6).map(p => {
      const parMail = /mail/i.test(String(p.MODE_CONTACT || '')) && p.Email;
      return {
      ico: parMail ? 'mail' : 'tel', titre: parMail ? 'Écrire' : 'Rappeler', nom: p.Nom_Compte || p.Enseigne || p.ID_Prospect || 'Lead', lieu: p.Ville || '',
      quand: this._fmt(p.Date_prochaine_action), raison: 'Rappel en retard', late: true,
      to: parMail ? 'mailto:' + p.Email : (p.ID_Compte || p.ID_Prospect) ? '#/phoning/' + encodeURIComponent(p.ID_Compte || p.ID_Prospect) : '#/phoning',
    }; });
    const aco = d.ac.slice(0, Math.max(0, 8 - rap.length)).map(r => ({
      ico: 'visite', titre: r.Axe === 'P1' ? 'Relancer un compte onboardé' : 'Convertir un compte qui commande',
      nom: r.Nom_Compte, lieu: r.Ville || '', quand: r.Jours != null ? r.Jours + ' j' : '', raison: r.Axe === 'P1' ? 'Onboardé sans commande' : 'A commandé, pas encore Empower',
      to: r.ID_Compte ? '#/compte/' + encodeURIComponent(r.ID_Compte) : '#/a-contacter',
    }));
    return [...rap, ...aco].map(a => `
      <button class="pilo-task" onclick="${a.to.startsWith('mailto:') ? `location.href='${E(a.to)}'` : `Router.aller('${E(a.to)}')`}">
        <span class="pilo-task-ico${a.late ? ' late' : ''}">${a.ico === 'tel' ? '☎' : a.ico === 'mail' ? '✉' : '⌂'}</span>
        <span class="pilo-task-main"><strong>${E(a.titre)}</strong><span>${E(a.nom)}${a.lieu ? ' · ' + E(a.lieu) : ''}</span></span>
        <span class="pilo-task-why"><span class="${a.late ? 'late' : ''}">${E(a.quand)}</span><small>${E(a.raison)}</small></span>
        <span class="pilo-chev" aria-hidden="true">›</span>
      </button>`).join('');
  },

  _equipe(d) {
    const E = this._esc;
    if (!d.equipe.length) return '<p class="pilo-vide">Aucun commercial dans le périmètre.</p>';
    const max = Math.max(1, ...d.equipe.map(m => m.ouverts));
    return d.equipe.map(m => `
      <button class="pilo-member" onclick="Router.aller('#/empower-tracker')">
        <span class="pilo-avatar">${E((m.nom || '?').charAt(0).toUpperCase())}</span>
        <span class="pilo-member-main"><strong>${E(m.nom)}</strong>
          <span>${m.ouverts} leads ouverts · ${m.echus ? `<span class="late">${m.echus} en retard</span>` : 'à jour'} · ${m.act} activités 7 j</span>
          <span class="pilo-bar"><i style="width:${Math.round(m.ouverts / max * 100)}%"></i></span></span>
        <span class="pilo-chev" aria-hidden="true">›</span>
      </button>`).join('') + '<p class="pilo-note">Synthèse descriptive, sans classement ni score opaque.</p>';
  },

  // ── Graphiques (décisions Pilotage fusionné) : filtres partagés avec les donuts via FilterState ──
  setQuarterCamembert(q) { FilterState.set({ quarter: q }); this.render(); },
  setCommercialCamembert(pin) { FilterState.set({ pinCommercial: pin ? Number(pin) : null }); this.render(); },
  toggleSemaineCamembert() { FilterState.set({ semaine: FilterState.get().semaine ? null : FiscalWeeks.codeDe() }); this.render(); },

  _barres(lignes, drill) {
    const E = this._esc, max = Math.max(1, ...lignes.map(l => l.v));
    return lignes.length ? `<div data-tipzone>` + lignes.map(l => `
      <button class="pilo-hbar" data-tip="${E(l.l)}\n${E(l.tip || l.txt)}" onclick="Router.aller('${drill}')">
        <span class="pilo-hbar-l">${E(l.l)}</span>
        <span class="pilo-hbar-t"><i style="width:${Math.max(2, Math.round(l.v / max * 100))}%;background:${l.c || '#343F48'}"></i></span>
        <b>${E(l.txt)}</b></button>`).join('') + `</div>` : '<p class="pilo-vide">Pas de donnée sur la période.</p>';
  },

  _graphiques(f) {
    const E = this._esc, raw = this._raw, eur = n => Math.round(n).toLocaleString('fr-FR') + ' €';
    const channel = Session.estChannel && Session.estChannel();
    const mien = pin => Session.voitTout() || Number(pin) === Number(Session.pin);
    const pinF = f.filtres.pinCommercial;
    const dansPerim = pin => pinF ? Number(pin) === Number(pinF) : mien(pin);
    const qf = f.quarter + 'FY27';
    const blocs = [];

    // Visites par type (période et commercial des filtres)
    const parType = {};
    f._visitesFiltrees.forEach(v => { const brut = String(v.Type_Visite || 'Non renseigné').trim() || 'Non renseigné', t = brut.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase()); parType[t] = (parType[t] || 0) + 1; });
    const types = Object.entries(parType).sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ l, v, txt: v + (v > 1 ? ' visites' : ' visite') }));
    blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Visites · ${E(f.quarter)}</span><h3>Visites par type</h3></div></div>${this._barres(types, '#/visites')}</section>`);

    if (!channel) {
      // Sell-in par canal de commande (Empower / Grossiste) : somme des comptes du périmètre
      const comptes = (raw.comptes || []).filter(c => dansPerim(c.PIN_CDS_Assigne));
      const tot = comptes.reduce((t, c) => t + CACanal.valeur(c, qf, 'TOUS'), 0);
      const emp = comptes.reduce((t, c) => t + CACanal.valeur(c, qf, 'EMPOWER'), 0);
      const seg = [{ label: 'Empower', value: Math.round(emp), color: '#343F48' }, { label: 'Grossiste', value: Math.max(0, Math.round(tot - emp)), color: '#B8BEC4' }];
      blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Sell-in · ${E(f.quarter)}</span><h3>Répartition par canal de commande</h3></div></div>
        <div class="pilo-donut">${window.svgDonut(seg, { size: 140, centreValeur: tot ? Math.round(emp / tot * 100) + ' %' : 'n.c.', centreLabel: 'Empower' })}
        <div class="pilo-leg">${seg.map(x => `<div data-tip="${E(x.label)}\n${eur(x.value)}"><i style="background:${x.color}"></i><span>${E(x.label)}</span><b>${eur(x.value)}</b></div>`).join('')}</div></div></section>`);

      // Comptes par canal (portefeuille) : Empower / Grossiste, cliquable vers Comptes
      const nEmp = comptes.filter(c => String(c.CANAL || c.Canal || '').toUpperCase() === 'EMPOWER').length;
      const seg2 = [{ label: 'Empower', value: nEmp, color: '#343F48' }, { label: 'Grossiste', value: Math.max(0, comptes.length - nEmp), color: '#B8BEC4' }];
      blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Portefeuille</span><h3>Comptes selon leur canal</h3></div><button class="pilo-lien" onclick="Router.aller('#/comptes')">Voir les comptes ›</button></div>
        <div class="pilo-donut">${window.svgDonut(seg2, { size: 140, centreValeur: comptes.length, centreLabel: 'Comptes' })}
        <div class="pilo-leg">${seg2.map(x => `<div data-tip="${E(x.label)}\n${x.value} comptes"><i style="background:${x.color}"></i><span>${E(x.label)}</span><b>${x.value}</b></div>`).join('')}</div></div></section>`);

      // Sell-in par trimestre et commercial + atteinte vs objectif
      const obs = (raw.objectifs || []).filter(o => dansPerim(o.PIN_CDS));
      const Q = ['Q1', 'Q2', 'Q3', 'Q4'];
      const lignesQ = Q.map(q => ({ l: q, v: obs.reduce((t, o) => t + Number(o[q + '_CA_Realise'] || 0), 0) })).map(x => ({ ...x, txt: eur(x.v), c: x.l === f.quarter ? '#343F48' : '#B8BEC4' }));
      blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Sell-in · FY27</span><h3>Par trimestre</h3></div></div>${this._barres(lignesQ, '#/objectifs')}</section>`);
      const att = obs.map(o => { const ca = Number(o[f.quarter + '_CA_Realise'] || 0), ob = Number(o[f.quarter + '_Obj_Revise'] || o[f.quarter + '_Obj_Initial'] || 0), pct = ob > 0 ? Math.round(ca / ob * 100) : 0; return { l: o.Nom_CDS || ('PIN ' + o.PIN_CDS), v: Math.min(pct, 150), txt: pct + ' %', c: pct >= 100 ? '#12805C' : pct >= 80 ? '#8A4B00' : '#C93A34' }; });
      blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Objectifs · ${E(f.quarter)}</span><h3>Atteinte par commercial</h3></div></div>${this._barres(att, '#/objectifs')}<p class="pilo-note">Vert ≥ 100 %, ambre ≥ 80 %, rouge sous 80 %.</p></section>`);
    }
    if (!channel) {
      const comptes = (raw.comptes || []).filter(c => dansPerim(c.PIN_CDS_Assigne));
      // Tracker Empower : comptes Empower activés (1re commande en sell-in) vs non activés, par commercial
      const emp = comptes.filter(c => window.estEmpower(c));
      const parPin = {};
      emp.forEach(c => { const k = Number(c.PIN_CDS_Assigne) || 0; (parPin[k] = parPin[k] || { a: 0, n: 0 })[FlagsCanal.active(c) ? 'a' : 'n']++; });
      const maxT = Math.max(1, ...Object.values(parPin).map(x => x.a + x.n));
      const nomDe = pin => pin ? window.resolveCDS(pin) : 'Non attribué';
      const lignesT = Object.entries(parPin).sort((a, b) => (b[1].a + b[1].n) - (a[1].a + a[1].n)).map(([pin, x]) => `
        <button class="pilo-stack" onclick="VueComptes.state.filtreEmpower='EMPOWER';Router.aller('#/comptes')">
          <span class="pilo-hbar-l">${E(nomDe(Number(pin)))}</span>
          <span class="pilo-stack-t" style="width:${Math.round((x.a + x.n) / maxT * 100)}%">
            <i class="a" style="flex:${x.a}" data-tip="${E(nomDe(Number(pin)))}\nActivés (1re commande) : ${x.a}"></i><i class="n" style="flex:${x.n}" data-tip="${E(nomDe(Number(pin)))}\nNon activés : ${x.n}"></i></span>
          <b>${x.a}/${x.a + x.n}</b></button>`).join('');
      const nA = emp.filter(c => FlagsCanal.active(c)).length;
      blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Tracker Empower · nourri par le sell-in</span><h3>Comptes activés vs non activés</h3></div></div>
        <div class="pilo-big">${nA}<small> activés sur ${emp.length} comptes Empower${emp.length ? ' · ' + Math.round(nA / emp.length * 100) + ' %' : ''}</small></div>
        <div data-tipzone>${lignesT || '<p class="pilo-vide">Aucun compte Empower.</p>'}</div>
        <p class="pilo-leg2"><span class="flag flag-act">${FlagsCanal.ICO.ok}Activé</span><span class="flag flag-noact">${FlagsCanal.ICO.no}Non activé</span></p></section>`);

      // Comptes ayant commandé par trimestre (sell-in), avec les premiers noms au survol
      const Qs = ['Q1', 'Q2', 'Q3', 'Q4'];
      const cmd = Qs.map(q => { const l = comptes.filter(c => CACanal.valeur(c, q + 'FY27', 'TOUS') > 0); return { l: q + (q === f.quarter ? ' (en cours)' : ''), v: l.length, txt: l.length + ' comptes', tip: l.length + ' comptes ont commandé' + (l.length ? '\n' + l.slice(0, 5).map(c => c.Nom_Compte).join(', ') + (l.length > 5 ? '…' : '') : ''), c: q === f.quarter ? '#343F48' : '#B8BEC4' }; });
      const fy = comptes.filter(c => Qs.some(q => CACanal.valeur(c, q + 'FY27', 'TOUS') > 0)).length;
      cmd.push({ l: 'FY27', v: fy, txt: fy + ' comptes', tip: fy + ' comptes distincts ont commandé sur FY27', c: '#5B7A99' });
      blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Sell-in · comptes ayant commandé</span><h3>Par trimestre et sur FY27</h3></div></div>${this._barres(cmd, '#/comptes')}</section>`);

      // Sell-in par trimestre ET par commercial (colonnes groupées)
      if (Session.voitTout()) {
        const obs = (raw.objectifs || []).filter(o => dansPerim(o.PIN_CDS));
        const Q = ['Q1', 'Q2', 'Q3', 'Q4'], teintes = ['#343F48', '#5B7A99', '#8C9BB8', '#B8BEC4', '#6B7580'];
        const maxV = Math.max(1, ...obs.flatMap(o => Q.map(q => Number(o[q + '_CA_Realise'] || 0))));
        const W = 320, H = 150, gw = (W - 20) / Q.length, bw = Math.max(6, (gw - 10) / Math.max(1, obs.length));
        const cols = Q.map((q, qi) => obs.map((o, oi) => { const v = Number(o[q + '_CA_Realise'] || 0), h = Math.round(v / maxV * (H - 34)); return `<rect x="${(10 + qi * gw + 4 + oi * bw).toFixed(1)}" y="${H - 18 - h}" width="${(bw - 2).toFixed(1)}" height="${Math.max(h, 1)}" rx="2" fill="${teintes[oi % teintes.length]}" tabindex="0" data-tip="${E(o.Nom_CDS || '')}\n${q} : ${eur(v)}"/>`; }).join('') + `<text x="${(10 + qi * gw + gw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="10" fill="#6B7580">${q}</text>`).join('');
        blocs.push(`<section class="pilo-panneau"><div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Sell-in · FY27</span><h3>Par trimestre et par commercial</h3></div></div>
          <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Sell-in par trimestre et par commercial" data-tipzone>${cols}</svg>
          <div class="pilo-leg pilo-leg-row">${obs.map((o, i) => `<div><i style="background:${teintes[i % teintes.length]}"></i><span>${E(o.Nom_CDS || '')}</span></div>`).join('')}</div></section>`);
      }
    }
    return `<div class="pilo-graphs-t"><span class="pilo-eyebrow">Graphiques</span></div>
      <div class="pilo-filtres-gr">${window.renderBlocCamemberts(f, raw, 'VuePilotage')}</div>
      <div class="pilo-grille pilo-grille-g">${blocs.join('')}</div>
      ${channel ? '' : window.renderBlocCAHebdo(f, 'VuePilotage', eur)}`;
  },

  setVue(v) { this.state.vue = v; this.render(); },

  render() {
    const s = this.state, app = document.getElementById('app');
    if (!s || !app) return;
    const E = this._esc, role = Session.voitTout();
    const entete = `<header class="header-vue"><h1>Pilotage</h1></header>`;
    let corps;
    if (s.chargement) corps = '<p class="pilo-vide">Chargement…</p>';
    else if (s.erreur) corps = `<div class="erreur">Erreur : ${E(s.erreur)}</div>`;
    else {
      const d = s.d, manager = role && s.vue === 'manager';
      const prenom = String(Session.nom || '').split(' ')[0];
      const heure = s.maj ? s.maj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
      corps = `
      <div class="pilo-contexte">
        <nav class="pilo-ariane" aria-label="Fil d'Ariane"><span>Pilotage</span><i>›</i><strong>Synthèse</strong></nav>
        ${role ? `<div class="pilo-seg" role="group" aria-label="Profil de lecture">
          <button class="${manager ? 'actif' : ''}" onclick="VuePilotage.setVue('manager')">Manager</button>
          <button class="${!manager ? 'actif' : ''}" onclick="VuePilotage.setVue('commercial')">Commercial</button></div>` : ''}
      </div>
      <div class="pilo-intro">
        <h2>${manager ? 'Où agir aujourd’hui ?' : `Bonjour ${E(prenom)}, voici vos priorités`}</h2>
        <p>${manager ? 'Vue manager · ' + (d.equipe.length || '') + ' commerciaux' : 'Votre activité terrain'} · trimestre ${E(d.quarter)}</p>
      </div>
      <p class="pilo-fraicheur">Données actualisées aujourd’hui à ${heure} · <button onclick="VuePilotage.init()">Actualiser</button></p>
      <div class="pilo-kpis">${this._kpis(d).map(k => `
        <button class="pilo-kpi${k.alerte ? ' alerte' : ''}" onclick="Router.aller('${k.to}')">
          <span class="pilo-kpi-l">${E(k.l)}</span><strong>${E(k.v)}</strong><small>${E(k.s)}</small><i aria-hidden="true">›</i>
        </button>`).join('')}</div>
      <div class="pilo-grille">
        <section class="pilo-panneau" aria-label="Actions prioritaires">
          <div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Actions prioritaires</span><h3>${manager ? 'À faire par l’équipe' : 'Mes actions du jour'}</h3></div>
            <button class="pilo-lien" onclick="Router.aller('#/a-contacter')">Tout voir ›</button></div>
          ${this._actions(d) || '<p class="pilo-vide">Rien d’urgent : aucun rappel échu ni compte à contacter.</p>'}
        </section>
        ${manager ? `<section class="pilo-panneau" aria-label="Synthèse d'équipe">
          <div class="pilo-panneau-t"><div><span class="pilo-eyebrow">Synthèse d’équipe</span><h3>Charge et points d’attention</h3></div></div>
          ${this._equipe(d)}</section>` : ''}
      </div>
      ${this._raw ? this._graphiques(window.calculerCamembertsActivite(this._raw)) : ''}`;
    }
    app.innerHTML = `${entete}${NavBar('home')}${window.FusionTabs ? FusionTabs.pilotage() : ''}<div class="pilo">${corps}</div>`;
  },
};
