function cleanVisibilityValue(value) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, 120)
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function questionWebsiteVisibility(row) {
  const rawValue = row && typeof row === 'object'
    ? row['Publication Ready?'] ?? row.publicationReady
    : row;
  const value = cleanVisibilityValue(rawValue);
  if (!value || value === 'yes') return 'visible';
  if (['no', 'hide', 'hidden', 'hide from website'].includes(value)) return 'hidden';
  return 'invalid';
}
