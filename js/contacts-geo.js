// ═══════════════════════════════════════════════════════════════════════
//  contacts-geo.js — Briques communes carte / complétude des contacts / paliers
//  1. ESI_GEO       : département déduit du code postal (sans service externe)
//  2. ContactsObjectif : complétude des fiches comptes (objectif 31/12/2026)
//  3. Paliers       : Dormant / Éveil / Actif / Ambassadeur (séminaire Impact)
//  Aucune donnée n'est envoyée hors de l'application.
// ═══════════════════════════════════════════════════════════════════════
(function () {
  const vide = v => v == null || String(v).trim() === '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ── 1. Département depuis le code postal ───────────────────────────────
  // Corse : 200xx-201xx = 2A, 202xx-206xx = 2B ; outre-mer 97x/98x sur 3 chiffres.
  // Même règle que la fonction SQL esi_dep_depuis_cp (supabase/propositions/carte_departement_cp.sql).
  function depDeCP(cp) {
    const p = String(cp == null ? '' : cp).trim();
    if (!/^\d{5}$/.test(p)) return null;
    if (p.startsWith('20')) return Number(p) < 20200 ? '2A' : '2B';
    if (p.startsWith('97') || p.startsWith('98')) return p.slice(0, 3);
    return p.slice(0, 2);
  }
  // Département d'une ligne compte/lead : colonne Departement d'abord, sinon code postal.
  function depDe(row) {
    const d = String((row && (row.Departement || row.departement)) || '').trim().toUpperCase();
    const m = d.match(/^(2A|2B|97\d|98\d|\d{2})/);
    if (m) return m[1];
    if (/^\d$/.test(d)) return '0' + d;
    return depDeCP(row && (row.Code_Postal || row.code_postal));
  }
  window.ESI_GEO = { depDeCP, depDe };

  // ── 2. Complétude des contacts ─────────────────────────────────────────
  // « Fiche renseignée » = au moins une de ces informations : interlocuteur, téléphone, e-mail ou adresse (règle validée le 6/11/2026).
  // « Fiche complète »   = interlocuteur ET (téléphone OU e-mail) ET adresse + code postal + ville.
  const CO = window.ContactsObjectif = {
    ECHEANCE: '2026-12-31',
    CHAMPS: [
      { cle: 'interlocuteur', lib: 'Interlocuteur', ok: c => !vide(c.Contact_Nom) },
      { cle: 'tel',           lib: 'Téléphone',     ok: c => !vide(c.Tel) },
      { cle: 'email',         lib: 'E-mail',        ok: c => !vide(c.Email) },
      { cle: 'adresse',       lib: 'Adresse',       ok: c => !vide(c.Adresse) },
      { cle: 'cp',            lib: 'Code postal',   ok: c => !vide(c.Code_Postal) },
      { cle: 'ville',         lib: 'Ville',         ok: c => !vide(c.Ville) },
    ],
    etat(c) {
      const f = {}; CO.CHAMPS.forEach(x => { f[x.cle] = x.ok(c); });
      const joignable = f.tel || f.email;
      const contact = !!(f.interlocuteur || f.tel || f.email || f.adresse);
      const adresse = f.adresse && f.cp && f.ville;
      const manquants = [];
      if (!f.interlocuteur) manquants.push('Interlocuteur');
      if (!joignable) manquants.push('Téléphone ou e-mail');
      if (!adresse) manquants.push(!f.cp ? 'Code postal' : !f.adresse ? 'Adresse' : 'Ville');
      const nb = CO.CHAMPS.filter(x => f[x.cle]).length;
      return { f, joignable, contact, adresse, complet: !!(f.interlocuteur && joignable && adresse), manquants, pct: Math.round(nb / CO.CHAMPS.length * 100) };
    },
    joursRestants(now) {
      const fin = new Date(CO.ECHEANCE + 'T23:59:59').getTime();
      return Math.max(0, Math.ceil((fin - (now || Date.now())) / 86400000));
    },
    stats(comptes) {
      const l = (comptes || []).filter(c => String(c.deleted || '').toUpperCase() !== 'TRUE');
      const par = {}, champs = {}; CO.CHAMPS.forEach(x => { champs[x.cle] = 0; });
      let contact = 0, complet = 0, joignable = 0;
      l.forEach(c => {
        const e = CO.etat(c);
        if (e.contact) contact++; if (e.complet) complet++; if (e.joignable) joignable++;
        CO.CHAMPS.forEach(x => { if (e.f[x.cle]) champs[x.cle]++; });
        const pin = c.PIN_CDS_Assigne || '';
        const o = par[pin] = par[pin] || { pin, tot: 0, contact: 0 };
        o.tot++; if (e.contact) o.contact++;
      });
      const tot = l.length, pct = n => tot ? Math.round(n / tot * 100) : 0;
      const jours = CO.joursRestants();
      const reste = tot - contact;
      return {
        tot, contact, complet, joignable, reste, champs, jours,
        pct: pct(contact), pctComplet: pct(complet),
        parSemaine: jours > 0 ? Math.ceil(reste / Math.max(1, jours / 7)) : reste,
        parCds: Object.values(par).map(o => ({ ...o, pct: o.tot ? Math.round(o.contact / o.tot * 100) : 0 })).sort((a, b) => a.pct - b.pct),
      };
    },
    // Jauge d'objectif. opts.sansCarte : contenu seul (pour l'intégrer dans un panneau existant).
    renderJauge(comptes, opts) {
      const s = CO.stats(comptes), nu = !!(opts && opts.sansCarte);
      const R = 70, C = Math.PI * R, arc = 'M 20 90 A 70 70 0 0 1 160 90';
      const lignes = s.parCds.filter(x => x.pin).map(x => `
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:6px">
          <span style="flex:0 0 110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(window.resolveCDS ? window.resolveCDS(x.pin) : x.pin)}</span>
          <span style="flex:1;height:8px;border-radius:4px;background:var(--c-border);overflow:hidden"><span style="display:block;height:100%;width:${x.pct}%;background:#FF6D68"></span></span>
          <span style="flex:0 0 96px;text-align:right;white-space:nowrap;color:var(--c-text-2)">${x.contact} / ${x.tot} · ${x.pct} %</span>
        </div>`).join('');
      const champs = CO.CHAMPS.map(x => {
        const p = s.tot ? Math.round(s.champs[x.cle] / s.tot * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:5px">
          <span style="flex:0 0 110px">${x.lib}</span>
          <span style="flex:1;height:6px;border-radius:3px;background:var(--c-border);overflow:hidden"><span style="display:block;height:100%;width:${p}%;background:#343F48"></span></span>
          <span style="flex:0 0 40px;text-align:right;color:var(--c-text-2)">${p} %</span></div>`;
      }).join('');
      const corps = `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:16px">
          <svg viewBox="0 0 180 104" width="200" role="img" aria-label="${s.pct} % des comptes ont un contact renseigné : ${s.contact} sur ${s.tot}" style="max-width:100%;flex:0 0 auto">
            <path d="${arc}" fill="none" stroke="var(--c-border)" stroke-width="16" stroke-linecap="round"/>
            <path d="${arc}" fill="none" stroke="#FF6D68" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(C * s.pct / 100).toFixed(1)} ${C.toFixed(1)}"/>
            <text x="90" y="80" text-anchor="middle" font-size="28" font-weight="800" fill="var(--c-title)">${s.pct} %</text>
            <text x="90" y="98" text-anchor="middle" font-size="10" fill="var(--c-text-2)">contacts renseignés</text>
          </svg>
          <div style="flex:1;min-width:170px">
            <div style="font-size:28px;font-weight:800;color:var(--c-title);line-height:1">${s.contact}<span style="font-size:15px;font-weight:600;color:var(--c-text-2)"> / ${s.tot}</span></div>
            <div style="font-size:12px;color:var(--c-text-2);margin-top:4px">comptes avec au moins un nom, un téléphone, un e-mail ou une adresse</div>
            <div style="font-size:12px;margin-top:6px">Objectif <strong>100 %</strong> au 31/12/2026 : <strong>${s.jours} j</strong> restants, soit <strong>${s.parSemaine}</strong> fiche${s.parSemaine > 1 ? 's' : ''} à compléter par semaine</div>
            <div style="font-size:12px;margin-top:4px;color:var(--c-text-2)">Fiches entièrement complètes (avec adresse) : ${s.complet} (${s.pctComplet} %)</div>
          </div>
        </div>
        ${lignes ? `<div style="margin-top:10px">${lignes}</div>` : ''}
        <details style="margin-top:10px"><summary style="font-size:12px;cursor:pointer;color:var(--c-text-2)">Détail par information</summary>${champs}</details>`;
      return nu ? corps : `<div class="bloc-fiche"><div class="bloc-titre">Contacts renseignés · objectif 31/12/2026</div>${corps}</div>`;
    },
    // ── Suivi du remplissage : deux mesures séparées, chacune avec sa barre et un filtre ───────────────────
    //  · Tracker : les comptes saisis dans l'application.
    //  · Base    : le fichier « BASE COMPTES ACTIFS - MATCHES ET ENRICHIS » (table base_comptes).
    //  Filtres communs : commercial et statut (renseignés / à compléter / complets).
    _filtre: { com: '', statut: '' },
    _cs: [], _base: null, _baseCharge: false,
    _nomCom(pin) { const n = window.resolveCDS ? window.resolveCDS(pin) : pin; return String(n || '').trim().toUpperCase().split(/\s+/)[0] || ''; },
    _baseVersCompte(b) {
      return { Contact_Nom: b.contact_principal || b.Contact_Principal, Tel: b.tel || b.Tel, Email: b.email || b.Email, Adresse: b.adresse || b.Adresse,
               Code_Postal: b.code_postal || b.Code_Postal, Ville: b.ville || b.Ville, Site_Web: b.site_web || b.Site_Web };
    },
    chargerBase() {
      if (CO._baseCharge || !window.SheetsAPI) return;
      CO._baseCharge = true;
      SheetsAPI.lire('EMPOWER_MDB', 'base_comptes', { nocache: true })
        .then(l => { CO._base = Array.isArray(l) ? l : []; CO._majSuivi(); })
        .catch(() => { CO._base = []; CO._majSuivi(); });
    },
    _bloc(titre, sous, n, tot, details, couleur) {
      const pct = tot ? Math.round(n / tot * 100) : 0;
      return `<section class="cs-jauge suivi-bloc" aria-label="${esc(titre)}">
        <div class="bloc-titre" style="margin-bottom:2px">${esc(titre)}</div>
        <div style="font-size:12px;color:var(--c-text-2);margin-bottom:8px">${esc(sous)}</div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
          <span style="font-size:28px;font-weight:800;color:var(--c-title);line-height:1">${pct} %</span>
          <span style="font-size:13px;color:var(--c-text-2)">${n} / ${tot}</span></div>
        <div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(titre)} : ${pct} %"
             style="height:12px;border-radius:6px;background:var(--c-border);overflow:hidden;margin-top:8px"><div style="height:100%;width:${pct}%;background:${couleur}"></div></div>
        ${details}</section>`;
    },
    _lignes(items, tot) {
      return `<details style="margin-top:10px"><summary style="font-size:12px;cursor:pointer;color:var(--c-text-2)">Détail par information</summary>${items.map(([lib, n]) => {
        const p = tot ? Math.round(n / tot * 100) : 0;
        return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-top:5px"><span style="flex:0 0 110px">${esc(lib)}</span>
          <span style="flex:1;height:6px;border-radius:3px;background:var(--c-border);overflow:hidden"><span style="display:block;height:100%;width:${p}%;background:#343F48"></span></span>
          <span style="flex:0 0 64px;text-align:right;color:var(--c-text-2)">${n} · ${p} %</span></div>`;
      }).join('')}</details>`;
    },
    _suiviHtml() {
      const f = CO._filtre;
      const vivants = (CO._cs || []).filter(c => String(c.deleted || '').toUpperCase() !== 'TRUE');
      const base = CO._base || [];
      const coms = Array.from(new Set([...vivants.map(c => CO._nomCom(c.PIN_CDS_Assigne)), ...base.map(b => String(b.commercial || b.Commercial || '').toUpperCase())].filter(Boolean))).sort();
      const stT = c => { const e = CO.etat(c); return e.complet ? 'complet' : e.contact ? 'renseigne' : 'a_completer'; };
      const stB = b => { const e = CO.etat(CO._baseVersCompte(b)); return e.complet ? 'complet' : (b.statut || b.Statut) === 'ENRICHI' ? 'renseigne' : 'a_completer'; };
      // Les filtres « renseigné » et « complet » se cumulent : un compte complet est aussi renseigné.
      const garde = (st, filtre) => !filtre || st === filtre || (filtre === 'renseigne' && st === 'complet');
      const tc = vivants.filter(c => (!f.com || CO._nomCom(c.PIN_CDS_Assigne) === f.com) && garde(stT(c), f.statut));
      const bc = base.filter(b => (!f.com || String(b.commercial || b.Commercial || '').toUpperCase() === f.com) && garde(stB(b), f.statut));
      const tRens = tc.filter(c => CO.etat(c).contact).length, bRens = bc.filter(b => stB(b) !== 'a_completer').length;
      const cnt = (l, fn) => l.filter(fn).length;
      const detT = CO._lignes([...CO.CHAMPS.map(x => [x.lib, cnt(tc, c => x.ok(c))]), ['Site web', cnt(tc, c => !vide(c.Site_Web))]], tc.length);
      const detB = CO._lignes([...CO.CHAMPS.map(x => [x.lib, cnt(bc, b => x.ok(CO._baseVersCompte(b)))]), ['Site web', cnt(bc, b => !vide(b.site_web || b.Site_Web))]], bc.length);
      const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
      const barreFiltre = `<div class="suivi-filtres" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <label style="font-size:12px;font-weight:600">Commercial <select aria-label="Filtrer par commercial" onchange="ContactsObjectif._filtre.com=this.value;ContactsObjectif._majSuivi()" style="margin-left:4px">
          ${opt('', 'Tous', f.com)}${coms.map(c => opt(c, c.charAt(0) + c.slice(1).toLowerCase(), f.com)).join('')}</select></label>
        <label style="font-size:12px;font-weight:600">Statut <select aria-label="Filtrer par statut" onchange="ContactsObjectif._filtre.statut=this.value;ContactsObjectif._majSuivi()" style="margin-left:4px">
          ${opt('', 'Tous', f.statut)}${opt('renseigne', 'Renseignés', f.statut)}${opt('a_completer', 'À compléter', f.statut)}${opt('complet', 'Fiches complètes', f.statut)}</select></label></div>`;
      const blocB = CO._base === null
        ? `<section class="cs-jauge suivi-bloc"><div class="bloc-titre">Infos comptes Base</div><p class="pilo-vide" style="font-size:13px">Chargement de la base…</p></section>`
        : CO._bloc('Infos comptes Base', 'Fichier des comptes actifs enrichis', bRens, bc.length, detB, '#343F48');
      return barreFiltre + `<div class="cs-jauges">${CO._bloc('Infos comptes Tracker', 'Comptes saisis dans l’application', tRens, tc.length, detT, '#FF6D68')}${blocB}</div>
        <p style="font-size:12px;color:var(--c-text-2);margin:8px 0 0">Objectif 100 % au 31/12/2026 : ${CO.joursRestants()} jours restants.</p>`;
    },
    _majSuivi() { document.querySelectorAll('.suivi-rempl').forEach(el => { el.innerHTML = CO._suiviHtml(); }); },
    renderSuivi(comptes) {
      CO._cs = comptes || [];
      CO.chargerBase();
      return `<div class="suivi-rempl">${CO._suiviHtml()}</div>`;
    },
    // Pastille de complétude d'une fiche (liste Comptes).
    pastille(c) {
      const e = CO.etat(c);
      const col = e.complet ? 'var(--c-success)' : e.contact ? 'var(--c-warning)' : 'var(--c-danger)';
      const t = e.complet ? 'Fiche complète' : 'À compléter : ' + e.manquants.join(', ');
      return `<span class="fiche-meter" title="${esc(t)}"><i style="width:${e.pct}%;background:${col}"></i></span>`;
    },
  };

  // ── 3. Paliers de revendeur (séminaire Impact) ─────────────────────────
  // CA Empower FY27 cumulé (proxy des 12 mois glissants : la donnée glissante et le nombre de commandes
  // ne sont pas dans la base). Seuils du séminaire : Éveil < 1 000 €, Actif ≥ 1 000 €, Ambassadeur ≥ 3 000 €.
  const SEUILS = { actif: 1000, ambassadeur: 3000 };
  const num = v => { const n = typeof window.parseCA === 'function' ? window.parseCA(v) : parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const PALIERS = {
    NA:          { cle: 'NA',          lib: 'Hors Empower', couleur: '#8A949E', action: 'Qualifier le potentiel Empower de ce revendeur.' },
    DORMANT:     { cle: 'DORMANT',     lib: 'Dormant',      couleur: '#8A949E', action: 'Relancer et envoyer le kit de démarrage.' },
    EVEIL:       { cle: 'EVEIL',       lib: 'Éveil',        couleur: '#C98A1B', action: 'Planifier une formation flash pour atteindre 1 000 €.' },
    ACTIF:       { cle: 'ACTIF',       lib: 'Actif',        couleur: '#2E7D5B', action: 'Surveiller le renouvellement et proposer une montée en gamme.' },
    AMBASSADEUR: { cle: 'AMBASSADEUR', lib: 'Ambassadeur',  couleur: '#343F48', action: 'Organiser une business review trimestrielle.' },
  };
  function caEmpower(c) { return ['CA_EMP_Q1FY27', 'CA_EMP_Q2FY27', 'CA_EMP_Q3FY27', 'CA_EMP_Q4FY27'].reduce((s, k) => s + num(c[k]), 0); }
  function palier(c) {
    if (!(window.estEmpower && window.estEmpower(c))) return PALIERS.NA;
    const ca = caEmpower(c);
    return ca >= SEUILS.ambassadeur ? PALIERS.AMBASSADEUR : ca >= SEUILS.actif ? PALIERS.ACTIF : ca > 0 ? PALIERS.EVEIL : PALIERS.DORMANT;
  }
  function badgePalier(c) {
    const p = palier(c); if (p.cle === 'NA') return '';
    return `<span class="palier-badge" style="--pc:${p.couleur}" title="Palier calculé sur le CA Empower FY27 cumulé">${p.lib}</span>`;
  }
  // Prochaine meilleure action : une règle lisible, jamais un score opaque.
  function prochaineAction(c) {
    const e = CO.etat(c);
    if (!e.contact) return { lib: 'Renseigner le contact', detail: 'Aucun nom, téléphone, e-mail ni adresse. Il manque : ' + e.manquants.join(', ') + '. Objectif de complétude au 31/12/2026.', cible: 'fiche' };
    const p = palier(c);
    return { lib: p.cle === 'NA' ? 'Qualifier' : p.lib, detail: p.action, cible: 'action' };
  }
  window.Paliers = { SEUILS, PALIERS, palier, badgePalier, caEmpower, prochaineAction };
})();
