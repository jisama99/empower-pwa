-- Décision du 5 nov. 2026 : PVP TTC Norton 360 Advanced 10 appareils = 59,99 €
-- (Book Empower). Platinum 20 reste à 79,99 €.
update public.catalogue_produits set pvp_ttc = 59.99 where produit_id = 'n360-adv10';
