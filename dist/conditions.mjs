// Open-Meteo precipitation/probability describe the preceding hour. Use the
// hour ending at/after arrival, never interpolate or sum rain across locations.
const number = v => typeof v === 'number' && Number.isFinite(v);
export function conditionsAt(hourly, epoch) {
  const times = hourly?.time, t = epoch / 1000;
  const empty = { precipitation: null, rainProbability: null, temperature: null, weatherCode: null };
  if (!Array.isArray(times) || times.length < 2 || t < times[0] || t > times.at(-1)) return empty;
  const i = times.findIndex(n => n >= t), j = Math.max(0, i - 1);
  const f = i === j ? 0 : (t - times[j]) / (times[i] - times[j]);
  const amount = hourly.precipitation?.[i], probability = hourly.precipitation_probability?.[i];
  const a = hourly.temperature_2m?.[j], b = hourly.temperature_2m?.[i];
  const code = hourly.weather_code?.[f < .5 ? j : i];
  return {
    precipitation: number(amount) && amount >= 0 ? amount : null,
    rainProbability: number(probability) && probability >= 0 && probability <= 100 ? probability : null,
    temperature: number(a) && number(b) ? a + (b - a) * f : null,
    weatherCode: number(code) ? code : null
  };
}

export function conditionName(code) {
  if (code === 0) return 'בהיר';
  if ([1, 2].includes(code)) return 'מעונן חלקית';
  if (code === 3) return 'מעונן';
  if ([45, 48].includes(code)) return 'ערפל';
  if ([51, 53, 55, 56, 57].includes(code)) return 'טפטוף';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'גשם';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'שלג';
  if ([95, 96, 99].includes(code)) return 'סופות רעמים';
  return 'מצב שמיים לא זמין';
}

export function summarizeConditions(samples) {
  if (!samples.length) throw new Error('אין נקודות להשוואה.');
  const max = key => Math.max(...samples.map(s => s[key]));
  const peak = samples.reduce((b, s, i) => s.crossGust > samples[b].crossGust ? i : b, 0);
  const quiet = samples.reduce((b, s, i) => s.crossGust < samples[b].crossGust ? i : b, 0);
  // A missing point cannot make a route appear dry or less rainy.
  const complete = key => samples.every(s => number(s[key]));
  return {
    maxCross: max('crossGust'), maxGust: max('gust'), maxSpeed: max('speed'), peak, quiet,
    maxRain: complete('precipitation') ? max('precipitation') : null,
    maxRainProbability: complete('rainProbability') ? max('rainProbability') : null
  };
}

// Compare the same displayed quantity on every route. Ties are kept, and the
// actual minimum does not depend on OSRM's route order or a running threshold.
export function compareWind(options) {
  const values = options.map(o => Math.round(o.maxCross));
  const min = Math.min(...values), max = Math.max(...values);
  return { spread: max - min, least: values.map((v, i) => v === min ? i : -1).filter(i => i >= 0) };
}
