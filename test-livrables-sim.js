// Tests du générateur de livrables PDF (sans DOM) : chiffres, offres, échappement, paysage.
global.window = global;
require('./js/catalogue.js'); require('./js/livrables-pdf.js');
let ok = 0, ko = 0; const t = (n, c) => { if (c) ok++; else { ko++; console.log('KO', n); } };
const lignes = [['n360-del5', 6], ['n360-std', 4], ['nsb-10', 3]];
const ids = Catalogue.listeProduits().map(p => p.id); t('ids', ids.length >= 10);
const L = window.LivrablesPDF;
const base = { type: 'proposition', lignes, client: { nom: '<b>X&Y</b>', contact: '"Z"' }, emetteur: { nom: 'Lyes Daoud', tel: '06 84 50 98 56', mail: 'a@b.fr' }, date: '2026-11-04', numero: 'PC-TEST' };
const r = L.calculer(base);
t('marge e', r.e.marge > 0 && r.e.licences === 13); t('gain', Math.abs(r.cmp.gain - (r.e.marge - r.g.marge)) < 0.011);
const h = L.html(base);
t('paysage', h.includes('@page{size:A4 landscape;margin:0}')); t('200mm', h.includes('width:297mm;height:210mm'));
t('échappé', h.includes('&lt;b&gt;X&amp;Y&lt;/b&gt;') && !h.includes('<b>X&Y</b>')); t('guillemets', h.includes('&quot;Z&quot;'));
t('logos', h.includes('norton-empower-reseller-dark.png') && h.includes('marvesting-group-cream.png'));
t('sans offre', !h.includes('class="ribbon"'));
t('visuel produit', h.includes('img/produits/n360-del5.png'));
// offre xy : offertes revendables, coût sur achetées uniquement
const o = L.html({ ...base, type: 'bienvenue', offre: { type: 'xy', achetees: 10, offertes: 1 }, validite: '2026-12-15' });
t('ribbon xy', o.includes('10 licences achetées, 1 offerte') && o.includes('15 décembre 2026'));
const ro = L.calculer({ ...base, type: 'bienvenue', offre: { type: 'xy', achetees: 10, offertes: 1 } });
t('offre améliore la marge', ro.e.marge >= r.e.marge);
// proposition : l'offre est ignorée
t('proposition ignore offre', L.calculer({ ...base, offre: { type: 'xy', achetees: 1, offertes: 1 } }).e.marge === r.e.marge);
const rem = L.html({ ...base, type: 'exceptionnelle', offre: { type: 'remise', taux: 0.1 } });
t('remise libellé', rem.includes('10 % de remise sur votre prix d&#39;achat') || rem.includes("10 % de remise sur votre prix d'achat"));
t('libellé inconnu', L.offreLibelle({ type: 'zz' }) === '' && L.offreLibelle(null) === '');
// produit sans PA Empower : signalé, jamais inventé
const sans = Catalogue.listeProduits().find(p => p.pa_empower == null);
if (sans) { const hs = L.html({ ...base, lignes: [[sans.id, 2], ['n360-std', 1]] }); t('exclu signalé', hs.includes('Non chiffré')); }
console.log(ok + ' OK, ' + ko + ' KO'); process.exit(ko ? 1 : 0);
