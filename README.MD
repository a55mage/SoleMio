# Sole Mio - Weather App

Schermata unica: a sinistra una scena animata in computer graphics (Canvas 2D procedurale) che riflette il meteo reale, con sotto le informazioni principali; a destra le previsioni dei prossimi 5 giorni.

## Features
- Scena animata: cielo con ora del giorno reale (alba, giorno, tramonto, notte), sole con raggi e lens flare, luna con fase corretta e stelle cadenti, nuvole volumetriche, pioggia con schizzi, neve, nebbia, temporale con fulmini
- Temperatura, temperatura percepita, vento (km/h + direzione), pioggia (probabilità e mm), umidità, alba e tramonto
- Prossimi 5 giorni; clic su un giorno per vedere la scena di quel giorno
- Ricerca città con suggerimenti e geolocalizzazione
- Ultima città salvata in localStorage, dati aggiornati ogni 10 minuti
- Responsive (mobile: layout in colonna)

## Struttura
- `index.html` – markup
- `css/style.css` – stile
- `js/scene.js` – motore della scena animata
- `js/app.js` – dati Open-Meteo e interfaccia

## Pubblicazione su GitHub Pages
Sito completamente statico, senza build né chiavi API: Settings → Pages → Deploy from a branch → `main` / root.

Sviluppo locale: `python3 -m http.server` e apri http://localhost:8000

## Technologies
- HTML5 / CSS / Vanilla JavaScript (nessuna dipendenza)
- Open-Meteo API e Geocoding API

## License
Open source and free to use.
