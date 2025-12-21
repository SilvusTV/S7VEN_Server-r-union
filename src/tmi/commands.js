import client from "./index.js";
import {getDailyDistanceRaw, getTotalDistanceRaw} from "../controllers/statistics.controller.js";
import { getLastLocationRaw } from "../controllers/locations.controller.js";
import { fetchCurrentWeather } from "../utils/weather.js";

// Expose a function to register all TMI commands
export function registerTmiCommands() {
  client.on('message', (channel, userstate, message, self) => {
    if (self) return;
    const msg = (message || '').trim().toLowerCase();
    if (msg === '!distance' || msg === '!distances') {
      Promise.all([getTotalDistanceRaw(), getDailyDistanceRaw()])
        .then(([totalDistance, dailyDistance]) => {
          const days = (dailyDistance && dailyDistance.perDay) || [];
          const daysStr = days
            .map(d => `${d.date} → ${Number(d.km).toFixed(2)} km ||`)
            .join('; ');
          const totalKm = totalDistance && totalDistance.km ? Number(totalDistance.km).toFixed(2) : '0.00';
          const reply = daysStr
            ? `Voici les distances parcourues : ${daysStr}. Total : ${totalKm} km.`
            : `Total : ${totalKm} km.`;
          client.say(channel, reply);
        })
        .catch(err => {
          console.error(err);
          client.say(channel, 'Erreur lors de la récupération des distances.');
        });
    }
    if (msg === '!meteo'){
      getLastLocationRaw()
        .then(async (loc) => {
          if (!loc) {
            client.say(channel, "Aucune localisation récente disponible.");
            return;
          }
          const { lat, lon, city, address, timezone } = loc;
          const where = city || address || `${Number(lat).toFixed(5)}, ${Number(lon).toFixed(5)}`;
          try {
            const w = await fetchCurrentWeather(lat, lon, { timezone });
            const parts = [];
            if (Number.isFinite(w.temperature)) parts.push(`${w.temperature.toFixed(1)}°C`);
            if (w.label) parts.push(w.label);
            if (Number.isFinite(w.apparent)) parts.push(`ressenti ${w.apparent.toFixed(1)}°C`);
            const windBits = [];
            if (Number.isFinite(w.windKmh)) windBits.push(`${Math.round(w.windKmh)} km/h`);
            if (Number.isFinite(w.windGustKmh)) windBits.push(`rafales ${Math.round(w.windGustKmh)} km/h`);
            if (windBits.length) parts.push(`vent ${windBits.join(', ')}`);
            const msgTxt = parts.length ? `Météo à ${where} : ${parts.join(', ')}.` : `Météo à ${where} : données indisponibles.`;
            client.say(channel, msgTxt);
          } catch (e) {
            console.error(e);
            client.say(channel, `Impossible de récupérer la météo pour ${where}.`);
          }
        })
        .catch(err => {
          console.error(err);
          client.say(channel, "Erreur lors de la récupération de la localisation.");
        });
    }
    if (msg === '!parcours'){
      client.say(channel, "Retrouvez le parcours sur l'ile ici : https://s7ven.silvus.me/parcours");
    }
    if (msg === '!help'){
      client.say(channel, "Liste des commandes disponibles : !distance, !meteo, !asso, !don, !parcours");
    }
  });
}

export default registerTmiCommands;