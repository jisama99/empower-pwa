// ═══════════════════════════════════════
//  livrables-pdf.js — Générateur de livrables commerciaux (PDF paysage A4, impression navigateur)
//  Trois modèles : proposition commerciale, offre de bienvenue, offre exceptionnelle.
//  Chiffres : exclusivement ceux de js/catalogue.js (prix des Réglages, cotation grossiste en cours incluse).
//  Design : celui de l'app (bandeau ardoise, logos Norton Empower et Marvesting, cartes douces sans traits).
//  Visuels : photos des licences attendues dans img/produits/<id produit>.png (ex. n360-std.png) ;
//            à défaut, une pastille typographique prend la place, sans casser la mise en page.
//  Les textes saisis (client, contact, conditions) sont toujours échappés.
// ═══════════════════════════════════════
window.LivrablesPDF = (function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const e0 = n => Math.round(n).toLocaleString('fr-FR') + ' €';
  const e2 = n => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const pc = n => String(n).replace('.', ',') + ' %';
  const jj = d => { const s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const dLong = d => { const s = String(d || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${Number(s.slice(8, 10))} ${MOIS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : ''; };

  const TYPES = {
    proposition:    { lib: 'Proposition commerciale', pref: 'PC', eyebrow: 'Proposition commerciale', titre: 'Votre <em>marge</em> sur Norton, produit par produit', offre: false },
    bienvenue:      { lib: 'Offre de bienvenue',      pref: 'OB', eyebrow: 'Offre de bienvenue',      titre: 'Votre première commande <em>Norton Empower</em>', offre: true },
    exceptionnelle: { lib: 'Offre exceptionnelle',    pref: 'OE', eyebrow: 'Offre exceptionnelle',    titre: 'Une offre <em>limitée</em> sur Norton', offre: true },
  };

  function offreLibelle(o) {
    if (!o || !o.type) return '';
    if (o.type === 'xy') return `${o.achetees} licence${o.achetees > 1 ? 's' : ''} achetée${o.achetees > 1 ? 's' : ''}, ${o.offertes} offerte${o.offertes > 1 ? 's' : ''}`;
    if (o.type === 'remise') return `${pc(Math.round(o.taux * 1000) / 10)} de remise sur votre prix d'achat`;
    return '';
  }

  // Calcule tout le contenu chiffré d'un livrable (testable sans DOM).
  function calculer(cfg) {
    const C = window.Catalogue, t = TYPES[cfg.type] || TYPES.proposition;
    const lignes = (cfg.lignes || []).filter(([id, q]) => q > 0);
    const offre = t.offre && cfg.offre && cfg.offre.type ? cfg.offre : null;
    const cmp = C.comparer(lignes, { grossiste: cfg.grossiste || 'pa_td', offre, volume: !!cfg.volume, date: cfg.date });
    const e = cmp.empower, g = cmp.grossiste;
    return { type: t, offre, cmp, e, g, gainPositif: cmp.gain > 0, reste: C.resteAuPalier((cfg.dejaCA || 0) + e.cout), grossisteNom: (cfg.grossiste === 'pa_ingram') ? 'Ingram' : 'Tech Data' };
  }

  function html(cfg) {
    const C = window.Catalogue, R = calculer(cfg), t = R.type, e = R.e, g = R.g, cmp = R.cmp;
    const cl = cfg.client || {}, em = cfg.emetteur || {};
    const compact = e.detail.length > 5 ? ' compact' : '';
    const base = (typeof document !== 'undefined' && document.baseURI) || '';
    const img = id => { try { return new URL('img/produits/' + encodeURIComponent(id) + '.png', base).href; } catch (x) { return 'img/produits/' + encodeURIComponent(id) + '.png'; } };
    const logo = f => { try { return new URL('img/' + f, base).href; } catch (x) { return 'img/' + f; } };
    const lignes = e.detail.map(d => `<div class="ln">
        <span class="pk"><img src="${esc(img(d.id))}" alt="" onerror="this.parentNode.classList.add('no')"/><b>${d.appareils}</b><i>appareil${d.appareils > 1 ? 's' : ''}</i></span>
        <span class="nm"><b>${esc(d.nom)}</b><small>${d.appareils} appareil${d.appareils > 1 ? 's' : ''} · PVP conseillé ${e2(d.pvp_ttc)} TTC</small></span>
        <span class="r q">${d.qte}${d.offertes ? `<small class="of">+ ${d.offertes} offerte${d.offertes > 1 ? 's' : ''}</small>` : ''}</span>
        <span class="r">${e2(d.pa)}</span><span class="r">${d.qte_vendue ? e2(d.marge / d.qte_vendue) : ''}</span><span class="r pos">${e2(d.marge)}</span></div>`).join('');
    const excl = cmp.exclus && cmp.exclus.length ? `<div class="note">Non chiffré, prix d'achat Empower non communiqué : ${esc(cmp.exclus.join(', '))}.</div>` : '';
    const manq = e.manquants && e.manquants.length ? `<div class="note">Non chiffré : ${esc(e.manquants.join(', '))}.</div>` : '';
    const offreBloc = R.offre ? `<div class="ribbon"><div><span class="eb">L'offre</span><b>${esc(offreLibelle(R.offre))}</b></div>${cfg.validite ? `<div><span class="eb">Valable jusqu'au</span><b>${esc(dLong(cfg.validite))}</b></div>` : ''}</div>` : '';
    const cotes = cmp.cotations && cmp.cotations.length ? ` Une cotation est en cours chez ${esc(R.grossisteNom)} (${esc(cmp.cotations.join(', '))}) : elle est prise en compte.` : '';
    const comparaison = R.gainPositif
      ? `<div class="card"><div class="eb">Même panier chez ${esc(R.grossisteNom)}</div><div class="cmpv">Marge de <b>${e0(g.marge)}</b> (${pc(g.pct)}), achat ${e0(g.cout)} HT${R.offre && R.offre.type === 'xy' ? ` pour ${g.licences} licences` : ''}.${cotes}</div><div class="bar"><i style="width:${Math.max(4, Math.min(100, Math.round(g.marge / (e.marge || 1) * 100)))}%"></i></div><div class="sub">Empower vous rapporte <b class="pos">${e0(cmp.gain)}</b> de plus sur ce panier.</div></div>`
      : `<div class="card"><div class="eb">Ce que vous gardez en plus</div><div class="cmpv">Revenue share Empower jusqu'à <b>${Math.round(C.revenue_share.taux_max * 100)} %</b> sur les renouvellements, pendant <b>${C.revenue_share.annees} ans</b>, selon les conditions du programme.</div></div>`;
    const rs = R.gainPositif ? `<div class="card"><div class="eb">Et ensuite</div><div class="cmpv">Revenue share jusqu'à <b>${Math.round(C.revenue_share.taux_max * 100)} %</b> sur les renouvellements pendant <b>${C.revenue_share.annees} ans</b>, selon les conditions du programme. Zéro stock, commande après encaissement.</div></div>` : '';
    const palier = `<div class="cta"><b>${R.reste > 0 ? 'Palier Actif à portée.' : 'Palier Actif atteint.'}</b> ${R.reste > 0 ? `Cette commande représente ${e0(e.cout)} d'achat : il vous reste ${e0(R.reste)} pour atteindre 1 000 € de chiffre d'affaires Empower.` : `Avec cette commande, vous dépassez 1 000 € de chiffre d'affaires Empower.`}</div>`;
    const num = cfg.numero || `${t.pref}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const dEmis = cfg.date || new Date().toISOString().slice(0, 10);
    const sousTitre = `Préparée pour <b>${esc(cl.nom || 'votre société')}</b>${cl.contact ? ' · Contact : ' + esc(cl.contact) : ''}${cl.region ? ' · ' + esc(cl.region) : ''}`;
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(t.lib)} ${esc(num)}</title>
<style>
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#DDE1E4}
body{font-family:Montserrat,system-ui,-apple-system,"Segoe UI",sans-serif;color:#424b53;font-size:11.5px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:297mm;height:210mm;margin:14px auto;background:#F7F8F9;box-shadow:0 8px 30px rgba(26,34,46,.15);position:relative;overflow:hidden;display:flex;flex-direction:column}
@media print{html,body{background:#fff}.page{margin:0;box-shadow:none}}
.top{height:25mm;background:#343F48;color:#fff;padding:0 15mm;display:flex;align-items:center;gap:9mm}
.top img{height:34px}.top .sep{width:1px;height:30px;background:rgba(255,255,255,.18)}
.top .meta{margin-left:auto;text-align:right;font-size:10.5px;line-height:1.6;opacity:.9}
.body{display:grid;grid-template-columns:1.75fr 1fr;gap:10mm;padding:8mm 15mm 0;flex:1;min-height:0;align-content:start}
.eyebrow,.eb{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#6B7580}
h1{font-size:25px;line-height:1.2;color:#1d2329;letter-spacing:-.01em;margin:5px 0 4px}
h1 em{font-style:normal;background:linear-gradient(transparent 62%,#FFD100 62%)}
.sub{color:#6B7580;font-size:12px}.sub b{color:#1d2329}
.lines{background:#fff;border-radius:16px;padding:12px 18px 14px;box-shadow:0 1px 10px rgba(26,34,46,.07);margin-top:6mm}
.hd,.ln{display:grid;grid-template-columns:13mm 1fr 15mm 21mm 21mm 23mm;gap:9px;align-items:center}
.hd{padding:4px 0 8px;font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#6B7580}.hd .p{grid-column:1/3}
.ln{padding:9px 0}.ln+.ln{margin-top:2px}.ln:nth-of-type(even){background:#F7F8F9;margin-left:-10px;margin-right:-10px;padding-left:10px;padding-right:10px;border-radius:10px}
.compact .ln{padding:5px 0}
.nm b{display:block;color:#1d2329;font-size:12px}.nm small{color:#6B7580;font-size:10px}
.r{text-align:right}.q{font-weight:700;color:#1d2329}.q small.of{display:block;color:#6B7580;font-weight:600;font-size:9.5px}
.pos{color:#1E7B55;font-weight:700}
.pk{width:13mm;height:13mm;border-radius:12px;background:#EEF1F3;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-direction:column}
.pk img{width:100%;height:100%;object-fit:contain}.pk b,.pk i{display:none}
.pk.no img{display:none}.pk.no b{display:block;font-size:19px;line-height:1;color:#343F48;font-weight:800}.pk.no i{display:block;font-style:normal;font-size:7px;color:#6B7580;margin-top:2px}
.ribbon{display:flex;gap:10mm;margin-top:4.5mm;background:#FFF3F2;border-radius:14px;padding:11px 18px}.ribbon b{display:block;color:#1d2329;font-size:13px;margin-top:1px}
.note{margin-top:8px;font-size:10px;color:#6B7580}
.col{display:flex;flex-direction:column;gap:4.5mm}
.card{background:#fff;border-radius:16px;padding:13px 16px;box-shadow:0 1px 10px rgba(26,34,46,.07)}
.k{background:#fff;border-radius:16px;padding:13px 16px;box-shadow:0 1px 10px rgba(26,34,46,.07)}
.k.main{background:#343F48;color:#fff}.k.main .eb{color:#B8C1C9}
.k big{display:block;font-size:30px;font-weight:800;letter-spacing:-.01em;margin-top:3px;color:#1d2329;line-height:1.1}.k.main big{color:#fff}
.k small{display:block;color:#6B7580;font-size:10px;margin-top:3px}.k.main small{color:#C9D0D6}
.two{display:grid;grid-template-columns:1fr 1fr;gap:4.5mm}.two .k big{font-size:19px}
.cmpv{margin-top:5px;font-size:11.5px}.cmpv b{color:#1d2329}
.bar{height:8px;border-radius:4px;background:#E4E8EB;overflow:hidden;margin:9px 0 6px}.bar i{display:block;height:100%;background:#343F48}
.cta{background:#FFF3F2;border-radius:16px;padding:13px 16px;font-size:11.5px}.cta b{color:#1d2329}
.foot{margin:5mm 15mm 9mm;display:grid;grid-template-columns:1.1fr 1fr;gap:10mm;align-items:end}
.contact{background:#fff;border-radius:16px;padding:12px 16px;box-shadow:0 1px 10px rgba(26,34,46,.07)}.contact b{font-size:13px;color:#1d2329}
.legal{font-size:8.8px;color:#6B7580;line-height:1.55}
.pill{display:inline-block;background:#E9EDF0;border-radius:999px;padding:2px 10px;font-size:9.5px;font-weight:700;color:#343F48;margin-bottom:3px}
</style></head><body><div class="page">
<div class="top"><img src="${esc(logo('norton-empower-reseller-dark.png'))}" alt="Norton Empower Reseller Program"/><span class="sep"></span><img src="${esc(logo('marvesting-group-cream.png'))}" alt="Marvesting Group"/>
<div class="meta">${esc(t.lib)} n° ${esc(num)}<br>Établie le ${esc(dLong(dEmis))}${cfg.validite ? `<br>Valable jusqu'au ${esc(dLong(cfg.validite))}` : ''}</div></div>
<div class="body"><div><div class="eyebrow">${esc(t.eyebrow)}</div><h1>${t.titre}</h1><div class="sub">${sousTitre}</div>
<div class="lines${compact}"><div class="hd"><span class="p">Produit</span><span class="r">Qté</span><span class="r">Achat HT</span><span class="r">Marge unit.</span><span class="r">Marge totale</span></div>${lignes || '<div class="note">Aucun produit sélectionné.</div>'}</div>
${offreBloc}${excl}${manq}</div>
<div class="col"><div class="k main"><div class="eb">Votre marge sur cette commande</div><big>${e0(e.marge)}</big><small>Soit ${pc(e.pct)} du chiffre d'affaires HT de ${e0(e.ca)}</small></div>
<div class="two"><div class="k"><div class="eb">Vous achetez</div><big>${e0(e.cout)}</big><small>HT, via le portail Empower</small></div><div class="k"><div class="eb">Vous revendez</div><big>${e0(e.ca)}</big><small>HT, ${e.licences} licence${e.licences > 1 ? 's' : ''}, prix conseillés</small></div></div>
${comparaison}${rs}${palier}</div></div>
<div class="foot"><div class="contact"><div class="eb">Votre contact</div><b>${esc(em.nom || '')}</b><div class="sub">${esc(em.role || 'Impact Sales Marketing / Norton Gen Digital')}</div><div style="margin-top:3px">${esc([em.tel, em.mail].filter(Boolean).join(' · '))}</div></div>
<div class="legal"><span class="pill">Prix indicatifs</span><br>Prix d'achat HT du portail Empower, catalogue ${esc(C.version)}. PVP HT = PVP TTC / 1,20. Marge = PVP HT moins prix d'achat. Les marges dépendent des prix de vente pratiqués.${R.offre ? ' Offre soumise aux conditions du programme Empower en vigueur.' : ''}${cfg.conditions ? ' ' + esc(cfg.conditions) : ''} Document commercial non contractuel.</div></div>
</div></body></html>`;
  }

  // Ouvre le livrable dans un nouvel onglet et lance l'impression (choisir « Enregistrer au format PDF », orientation paysage déjà réglée).
  function ouvrir(cfg) {
    const w = window.open('', '_blank');
    if (!w) { if (window.Toast) Toast.afficher('Autorisez les fenêtres pop-up pour générer le PDF', 'erreur'); return false; }
    w.document.open(); w.document.write(html(cfg)); w.document.close();
    w.addEventListener('load', () => setTimeout(() => { try { w.focus(); w.print(); } catch (x) {} }, 600));
    return true;
  }

  return { TYPES, offreLibelle, calculer, html, ouvrir };
})();
