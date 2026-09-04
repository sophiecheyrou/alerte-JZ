# Alerte JZ — version simplifiée

Cette version privilégie la rapidité d’appel :

- aucun filtre « Tous / Présents / Non localisés » ;
- aucun bouton de filtre par étage ;
- chambres directement regroupées par étage ;
- recherche immédiate par numéro de chambre ;
- Cour Montmorency / Cour d’honneur : 1 clic = Présent, clic suivant = Non localisé ;
- Loge : 1 clic = Sorti, clic suivant = Non localisé ;
- Tableau de bord : uniquement les compteurs et la liste compacte des chambres non localisées ;
- archivage local d’un exercice ;
- génération d’un compte-rendu texte ;
- préparation d’un courriel avec le compte-rendu ;
- schéma Supabase mis à jour pour les exercices, événements et archives.

## Pour GitHub Pages
Remplacer les fichiers du dépôt par ceux de ce dossier, puis conserver `config.js` avec vos paramètres Supabase si la synchronisation en temps réel est activée.

## Important
La fonction « Envoyer par mail » ouvre le logiciel de messagerie de l’appareil avec le compte-rendu prérempli. Elle n’envoie pas automatiquement le message sans intervention de l’utilisateur.


## V8
- Archives : suppression individuelle ou multiple avec sélection.
- Cohérence : la LOGE utilise désormais exactement le même périmètre de chambres que le TABLEAU DE BORD, donc le compteur « Non localisés » est identique sur les deux pages.

## V9 — fiabilité / stabilité
- Source des chambres dédupliquée au chargement (une chambre = une seule occurrence).
- Cour Montmorency reconstruite à chaque ouverture uniquement avec les chambres paires, classées par étage.
- Cour d’honneur reconstruite à chaque ouverture uniquement avec les chambres impaires, classées par étage.
- Les anciens contenus DOM sont supprimés avant chaque rendu afin d’empêcher les doublons après navigation.
- Tableau de bord strictement en lecture seule : aucune action de clic ne peut modifier Présents / Sortis / Non localisés.
- Cache PWA V9 corrigé : tous les fichiers utilisent la même version afin d’éviter le mélange avec d’anciens scripts.
