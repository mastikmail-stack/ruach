// Plain-language summaries shared by route cards and the point being viewed.
// Unavailable data remains explicit; zero precipitation is never inferred.
export function rainLabel(amount, probability) {
  if (amount === null || amount === undefined) return 'נתוני גשם חסרים';
  if (amount > 0) return 'צפוי גשם';
  if (probability === null || probability === undefined) return 'גשם: הסיכוי לא זמין';
  if (probability > 0) return `סיכוי לגשם ${Math.round(probability)}%`;
  return 'לא צפוי גשם';
}
