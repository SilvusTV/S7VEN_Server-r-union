// Helper to normalize pseudo: lowercase, strip diacritics, trim and collapse spaces
export function normalizePseudo(input) {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export default { normalizePseudo };
