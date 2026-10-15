// Eight fractional digits, represented exactly. No Number arithmetic on money.
export function decimalUnits(value) {
  if (typeof value !== 'string' || value.length > 32 || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(value)) {
    throw new TypeError('Invalid decimal');
  }
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return (BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, '0'))) * (value.startsWith('-') ? -1n : 1n);
}
