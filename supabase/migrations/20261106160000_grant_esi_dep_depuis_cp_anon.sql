-- Correctif : « permission denied for function esi_dep_depuis_cp » à la création d'un lead.
-- Le déclencheur esi_remplir_dep (leads et comptes) appelle cette fonction pure ; l'application se connecte avec le rôle anon,
-- qui n'avait pas EXECUTE. Sans ce droit, toute création de lead ou changement de code postal échoue.
grant execute on function public.esi_dep_depuis_cp(text) to anon;
