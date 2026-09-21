import { COST_CENTER_LENGTH } from './constants.js';

const DIGITS = /^\d{8}$/;

/** Removes whitespace; returns the 8-digit storage form or null if invalid. */
export function normalizeCostCenter(input: string): string | null {
  const s = input.replace(/\s+/g, '');
  return DIGITS.test(s) ? s : null;
}

/** "11111111" -> "1111 1111" */
export function formatCostCenter(number: string): string {
  if (number.length !== COST_CENTER_LENGTH) return number;
  return `${number.slice(0, 4)} ${number.slice(4)}`;
}

export function isValidCostCenter(input: string): boolean {
  return normalizeCostCenter(input) !== null;
}
