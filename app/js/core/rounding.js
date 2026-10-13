// Verrechnungsregeln (Strategien) für die Anrechnung der Nettoarbeitszeit auf das Zeitkonto.
//
// Jede Strategie bekommt die Nettoarbeitszeit eines abgeschlossenen Tages, den Rest aus den
// Vortagen und das Intervall, und liefert:
//   credited   – für die Abrechnung angerechnete Minuten (Vielfaches des Intervalls oder exakt)
//   carryOut   – Rest, der in den nächsten Tag übertragen wird (0 ≤ carryOut < Intervall)
//   forfeited  – Minuten, die nach dieser Regel verfallen (nur bei ausdrücklich gewählter Regel,
//                werden immer sichtbar ausgewiesen)
//
// Invariante für jede Strategie: net + carryIn = credited + carryOut + forfeited.
// Damit kann keine Minute unbemerkt verschwinden oder doppelt angerechnet werden.

export const ROUNDING_MODES = {
  carry: {
    label: 'Volle Intervalle anrechnen, Rest übertragen (empfohlen)',
    usesCarry: true,
    apply(net, carryIn, interval) {
      const available = net + carryIn;
      const credited = Math.floor(available / interval) * interval;
      return { credited, carryOut: available - credited, forfeited: 0 };
    },
  },
  exact: {
    label: 'Minutengenau (keine Rundung)',
    usesCarry: false,
    apply(net) {
      return { credited: net, carryOut: 0, forfeited: 0 };
    },
  },
  floor: {
    label: 'Abrunden, Reste verfallen (werden als „verfallen“ ausgewiesen)',
    usesCarry: false,
    apply(net, _carryIn, interval) {
      const credited = Math.floor(net / interval) * interval;
      return { credited, carryOut: 0, forfeited: net - credited };
    },
  },
};

/** Was mit dem angesammelten Rest am Monatsende passiert (nur bei Modus "carry"). */
export const CARRY_RULES = {
  keep: 'Rest unbegrenzt weiter übertragen',
  'month-credit': 'Rest am Monatsende minutengenau gutschreiben',
  'month-forfeit': 'Rest am Monatsende verfallen lassen (wird ausgewiesen)',
};

export function getStrategy(mode) {
  return ROUNDING_MODES[mode] || ROUNDING_MODES.carry;
}

export function applyRounding(mode, net, carryIn, interval) {
  if (!Number.isInteger(interval) || interval < 1) interval = 1;
  const r = getStrategy(mode).apply(net, carryIn, interval);
  if (r.credited + r.carryOut + r.forfeited !== net + (getStrategy(mode).usesCarry ? carryIn : 0)) {
    throw new Error('Interner Fehler: Verrechnungsinvariante verletzt');
  }
  return r;
}
