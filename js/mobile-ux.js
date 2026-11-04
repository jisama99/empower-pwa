// ═══════════════════════════════════════
//  mobile-ux.js : confort d'usage sur téléphone
//  - Blocs repliables : les jauges de la liste des comptes tiennent en une ligne de résumé, les blocs de la fiche compte
//    se déplient au toucher (le premier reste ouvert). Le contenu reste dans la page : rien n'est supprimé.
//  Réservé aux écrans < 900 px ; aucun effet sur le bureau.
// ═══════════════════════════════════════
window.MobileUX = (function () {
  const mq = window.matchMedia ? window.matchMedia('(max-width: 899px)') : { matches: false };
  const ouvertes = new Set();   // blocs que l'utilisateur a dépliés : conservés quand la fiche se redessine

  function resumeJauges(el) {
    const js = [...el.querySelectorAll('.cs-jauge')];
    const parties = js.map(j => {
      const tt = ((j.querySelector('.bloc-titre') || {}).textContent || ''), t = tt.split('·')[0].trim();
      const m = (j.textContent || '').replace(tt, '').match(/(\d+)\s*\/\s*(\d+)/);   // le chiffre « n / total » du corps, pas la date du titre
      return t ? t + (m ? ' ' + m[1] + '/' + m[2] : '') : null;
    }).filter(Boolean);
    return parties.join(' · ') || 'Objectifs';
  }
  function jauges() {
    document.querySelectorAll('.cs-jauges:not([data-mob])').forEach(el => {
      el.dataset.mob = '1'; el.classList.add('mob-replie');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mob-resume'; b.setAttribute('aria-expanded', 'false');
      b.textContent = resumeJauges(el);
      b.onclick = () => { const ferme = el.classList.toggle('mob-replie'); b.setAttribute('aria-expanded', String(!ferme)); };
      el.parentNode.insertBefore(b, el);
    });
  }
  function blocsFiche() {
    document.querySelectorAll('.fiche-body').forEach(corps => {
      const blocs = [...corps.querySelectorAll(':scope > .bloc-fiche, :scope > * > .bloc-fiche')];
      blocs.forEach((bloc, i) => {
        const titre = bloc.querySelector(':scope > .bloc-titre');
        if (!titre || bloc.dataset.mob) return;
        bloc.dataset.mob = '1'; bloc.classList.add('mob-pliable');
        const cle = (titre.textContent || '').trim();
        if (blocs.length > 2 && !ouvertes.has(cle)) bloc.classList.add('mob-replie');   // plusieurs blocs : tout replié, un toucher déplie
        titre.setAttribute('role', 'button'); titre.tabIndex = 0;
        const basculer = () => { const ferme = bloc.classList.toggle('mob-replie'); ferme ? ouvertes.delete(cle) : ouvertes.add(cle); };
        titre.addEventListener('click', basculer);
        titre.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculer(); } });
      });
    });
  }
  function appliquer() { if (!mq.matches) return; try { jauges(); blocsFiche(); } catch (e) { /* le confort ne doit jamais casser une page */ } }

  function init() {
    const app = document.getElementById('app'); if (!app) return;
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(appliquer, 40); }).observe(app, { childList: true, subtree: true });
    appliquer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  return { appliquer };
})();
