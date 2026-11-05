// ═══════════════════════════════════════
//  visionneuse.js : affichage des documents DANS l'application (PDF générés, fichiers du Kit, générateur de mandat)
//  Remplace window.open('_blank') : sur téléphone (appli installée) une nouvelle fenêtre n'a ni bouton retour ni fermeture.
//  La visionneuse est une couche plein écran avec un bouton « Fermer » toujours visible ; le retour système (geste, bouton)
//  la ferme aussi (couche d'historique gérée par le routeur, via l'identifiant #visionneuse).
// ═══════════════════════════════════════
window.Visionneuse = (function () {
  const LARGEUR_A4 = 1123;   // A4 paysage à 96 dpi : les documents générés sont mis à l'échelle pour tenir dans l'écran
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let ecoute = null, redim = null, blobs = [];

  function fermer() {
    const e = document.getElementById('visionneuse'); if (e) e.remove();
    document.body.classList.remove('vis-ouverte');
    document.removeEventListener('keydown', echap);
    if (redim) { window.removeEventListener('resize', redim); redim = null; }
    blobs.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) { /* déjà libéré */ } }); blobs = [];
    ecoute = null;
  }
  function echap(e) { if (e.key === 'Escape') fermer(); }

  function cadre(titre, actionsHtml, corpsHtml) {
    fermer();
    const el = document.createElement('div');
    el.id = 'visionneuse';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', titre);
    el.innerHTML = `<header class="vis-barre">
        <button type="button" class="vis-fermer" data-vis="fermer" aria-label="Fermer"><span aria-hidden="true">←</span> Fermer</button>
        <div class="vis-titre">${esc(titre)}</div>
        <div class="vis-actions">${actionsHtml || ''}</div>
      </header>
      <div class="vis-corps">${corpsHtml}</div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-vis]'); if (!b) return;
      const a = b.dataset.vis;
      if (a === 'fermer') fermer();
      else if (a === 'imprimer') imprimer();
    });
    document.body.appendChild(el);
    document.body.classList.add('vis-ouverte');
    document.addEventListener('keydown', echap);
    return el;
  }

  function imprimer() {
    const f = document.querySelector('#visionneuse iframe'); if (!f) return;
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch (e) { if (window.Toast) Toast.afficher('Impression indisponible sur cet appareil', 'erreur'); }
  }

  // Document HTML généré par l'application (livrables, reporting) : aperçu à l'échelle de l'écran, impression / PDF au bouton.
  function html(doc, opt) {
    opt = opt || {};
    const el = cadre(opt.titre || 'Document',
      `<button type="button" class="vis-btn p" data-vis="imprimer">Imprimer / PDF</button>`,
      `<div class="vis-defil"><div class="vis-feuille"><iframe title="${esc(opt.titre || 'Document')}" sandbox="allow-same-origin allow-modals"></iframe></div></div>`);
    const defil = el.querySelector('.vis-defil'), feuille = el.querySelector('.vis-feuille'), f = el.querySelector('iframe');
    const largeur = opt.largeur || LARGEUR_A4;
    f.style.width = largeur + 'px';
    let zoom = 1;   // multiplicateur par rapport à « tenir dans la largeur »
    const ajuster = () => {
      const base = Math.min(1, (defil.clientWidth - 16) / largeur) || 1, k = base * zoom;
      let h = 1200;
      try { const d = f.contentDocument; h = Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0, 600); } catch (e) { /* hauteur par défaut */ }
      f.style.height = h + 'px';
      f.style.transform = 'scale(' + k + ')';
      feuille.style.width = Math.round(largeur * k) + 'px';
      feuille.style.height = Math.round(h * k) + 'px';
      feuille.style.margin = k * largeur > defil.clientWidth - 16 ? '0' : '0 auto';
    };
    const regler = z => { zoom = Math.max(1, Math.min(4, z)); ajuster(); };
    el.querySelector('.vis-corps').insertAdjacentHTML('beforeend', `<div class="vis-zoom" role="group" aria-label="Zoom"><button type="button" data-z="-" aria-label="Réduire">−</button><button type="button" data-z="0" aria-label="Ajuster à l'écran">Ajuster</button><button type="button" data-z="+" aria-label="Agrandir">+</button></div>`);
    el.querySelector('.vis-zoom').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (!b) return; regler(b.dataset.z === '0' ? 1 : zoom * (b.dataset.z === '+' ? 1.5 : 1 / 1.5)); });
    f.addEventListener('load', () => { ajuster(); setTimeout(ajuster, 400); setTimeout(ajuster, 1500); });
    redim = ajuster; window.addEventListener('resize', redim);
    f.srcdoc = doc;
    return true;
  }

  // Page de l'application (même origine), ex. le générateur de mandat : la page parente reste joignable via window.parent.
  function page(url, opt) {
    opt = opt || {};
    cadre(opt.titre || 'Document', '', `<iframe class="vis-plein" title="${esc(opt.titre || 'Document')}" src="${esc(url)}"></iframe>`);
    return true;
  }

  // Fichier hébergé (lien signé) : aperçu des PDF et images (téléchargés puis affichés depuis la mémoire, sans quitter l'application) ;
  // autres formats ou aperçu impossible : boutons Ouvrir / Télécharger. « Fermer » reste toujours visible.
  function fichier(url, opt) {
    opt = opt || {};
    const fmt = String(opt.format || '').replace(/^\./, '').trim().toLowerCase();
    const pdf = fmt === 'pdf', img = /^(png|jpe?g|webp|gif)$/.test(fmt);
    const lien = (u, lib, cls) => u ? `<a class="vis-btn ${cls || ''}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${lib}</a>` : '';
    const carte = msg => `<div class="vis-vide"><p><strong>${esc(opt.titre || 'Fichier')}</strong></p><p>${msg}</p></div>`;
    const el = cadre(opt.titre || 'Fichier', lien(url, 'Ouvrir', pdf || img ? '' : 'p') + lien(opt.telechargement, 'Télécharger', ''),
      pdf || img ? carte('Chargement du document…') : carte(`Ce format (${esc(opt.format || 'fichier')}) s'ouvre dans une autre application. Utilisez « Ouvrir » ou « Télécharger », puis revenez ici avec « Fermer ».`));
    if (!(pdf || img)) return true;
    const corps = el.querySelector('.vis-corps');
    fetch(url).then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); }).then(b => {
      if (!el.isConnected) return;
      const u = URL.createObjectURL(new Blob([b], { type: pdf ? 'application/pdf' : (b.type || 'image/' + (fmt === 'jpg' ? 'jpeg' : fmt)) }));
      blobs.push(u);
      corps.innerHTML = pdf ? `<iframe class="vis-plein" title="${esc(opt.titre || 'Fichier')}" src="${u}"></iframe>` : `<div class="vis-defil"><img class="vis-img" alt="${esc(opt.titre || 'Image')}" src="${u}"/></div>`;
    }).catch(() => { if (el.isConnected) corps.innerHTML = carte("L'aperçu n'est pas disponible ici. Utilisez « Ouvrir » ou « Télécharger », puis revenez avec « Fermer »."); });
    return true;
  }

  return { html, page, fichier, fermer, imprimer };
})();
