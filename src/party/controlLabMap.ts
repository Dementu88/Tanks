/** Ściany tworzą nawroty, a połówki ćwiczą precyzyjne ustawienie w przejściach. */
export const CONTROL_LAB_MAZE = [
  'X  X  X  X  X  X  X  X  X  X  X  X  X',
  'X  Tf Tf Tf Tf Tf Tf Tf Tf X  X  X  X',
  'X  X  X  X  X  X  X  X  T5 X  X  X  X',
  'X  X  X  Bf Bf Bf Bf Bf Bf Bf X  X  X',
  'X  X  X  X  X  X  X  X  X  X  X  X  X',
  'X  Tf Tf Tf Tf Tf Tf X  X  X  X  X  X',
  'X  X  X  T5 X  X  X  X  X  Ta X  X  X',
  'X  X  X  T5 X  X  X  X  X  Ta X  X  X',
  'X  X  X  Tf X  X  X  Tf Tf Tf Tf Tf X',
  'X  X  X  X  X  X  X  X  X  X  X  X  X',
  'X  Tf Tf T3 X  X  X  X  X  Bc Bf X  X',
  'X  X  X  X  X  X  X  X  X  X  X  X  X',
  'X  X  X  X  X  X  X  X  X  X  X  X  X',
].map((line, row) =>
  line
    .trim()
    .split(/\s+/)
    .map((cell, col) => (row === 0 || row === 12 || col === 0 || col === 12 ? 'Tf' : cell))
    .join(' '),
)
