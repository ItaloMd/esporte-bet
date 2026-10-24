import React, { useMemo } from "react";
import { formatDateShort, formatDay, toDateInputValue } from "@/lib/format";

const DAYS_AHEAD = 7;
const BASE = "shrink-0 rounded-lg border px-3 py-1.5 text-center text-sm transition-colors";
const ON = "border-primary bg-primary/15 text-foreground";
const OFF = "border-border bg-card text-muted-foreground hover:border-primary/50";

/**
 * Faixa de datas para navegar entre os próximos dias, no estilo das casas de
 * apostas: escolher um dia mostra somente as partidas daquela data.
 */
export default function DateStrip({ value, onChange }) {
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, index) => {
      const date = new Date(today.getTime() + index * 86400000);
      return { value: toDateInputValue(date), label: formatDay(date), date: formatDateShort(date) };
    });
  }, []);

  return (
    <div className="hide-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      <button type="button" onClick={() => onChange("")} className={`${BASE} ${value ? OFF : ON}`}>
        <span className="block font-medium">Todas</span>
        <span className="text-[11px] opacity-70">datas</span>
      </button>
      {days.map((day) => (
        <button
          key={day.value}
          type="button"
          onClick={() => onChange(day.value)}
          className={`${BASE} ${value === day.value ? ON : OFF}`}
        >
          <span className="block font-medium">{day.label}</span>
          <span className="text-[11px] opacity-70">{day.date}</span>
        </button>
      ))}
    </div>
  );
}