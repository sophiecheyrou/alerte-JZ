# PWA Suivi sécurité – Internat Jean Zay – Version 2

## Tester immédiatement
1. Décompresser le ZIP.
2. Ouvrir `index.html` dans un navigateur récent.
3. Les données sont enregistrées localement en mode démonstration.

## Règles d’utilisation
- Cour Montmorency / Cour d’honneur : un appui rend la chambre verte (présent), un nouvel appui la remet rouge (non localisé).
- Loge : un appui rend la chambre jaune (sorti), un nouvel appui la remet rouge.
- Tableau de bord : lecture seule, avec affichage prioritaire des chambres non localisées.
- Bouton « Nouvel exercice » : remet toutes les chambres à l’état rouge après confirmation.

## Synchronisation multi-appareils
Renseigner Supabase dans `config.js` et exécuter `supabase.sql` dans le projet Supabase. En mode partagé, chaque action est enregistrée comme un événement et diffusée aux autres appareils.

## Déploiement PWA
Héberger le dossier sur un service HTTPS (Netlify, Vercel, GitHub Pages ou serveur académique). L’installation sur l’écran d’accueil sera alors disponible.
