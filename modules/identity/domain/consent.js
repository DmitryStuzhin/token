const CURRENT_CONSENTS = Object.freeze({
  personal_data: '2026-08-13',
  terms: '2026-08-13',
});

function validateConsents(input) {
  const provided = input && typeof input === 'object' ? input : {};
  return Object.entries(CURRENT_CONSENTS).every(([type, version]) => provided[type] === version);
}

module.exports = { CURRENT_CONSENTS, validateConsents };
