const crypto = require('node:crypto');

/**
 * Алфавит без символов, которые путают при переписывании из письма:
 * нет 0/O, 1/I/L и U/V. Пользователь диктует код вслух и вводит руками,
 * поэтому неоднозначный символ стоит дороже, чем потерянная энтропия.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
const GROUP = 3;
const GROUPS = 3;
const LENGTH = GROUP * GROUPS;

/** 29^9 ≈ 2^43.7 вариантов. Перебор ограничен пятью попытками на код. */
function generateCode() {
  let code = '';
  for (let index = 0; index < LENGTH; index += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

/** K7M2PQ9XZ → K7M-2PQ-9XZ. Хранится и сравнивается всегда плоская форма. */
function formatCode(code) {
  return (String(code).match(/.{1,3}/g) || []).join('-');
}

/**
 * Пользователь вставляет код как угодно: со строчными буквами, с пробелами,
 * с лишними дефисами, иногда с невидимым пробелом из письма. Нормализуем
 * всё это к плоской заглавной форме, прежде чем сравнивать.
 */
function normalizeCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isWellFormed(input) {
  const normalized = normalizeCode(input);
  return normalized.length === LENGTH && [...normalized].every((char) => ALPHABET.includes(char));
}

module.exports = { generateCode, formatCode, normalizeCode, isWellFormed, LENGTH };
