import React, { useMemo } from "react";
import { formatDateShort, formatDay, toDateInputValue } from "@/lib/format";

const DAYS_AHEAD = 7;
const BASE = "shrink-0 rounded-md border px-2.5 py-1 text-center text-xs font-medium transition-colors";
const ON = "border-primary bg-primary text-primary-foreground";
const OFF = "border-border bg-secondary/40 text-muted-foreground hover:border-primary/50 hover:text-foreground";

/**
 * Faixa de datas no estilo das casas de apostas: escolher um dia mostra
 * somente as partidas daquela data.
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
    <div className="hide-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
      <button type="button" onClick={() => onChange("")} className={`${BASE} ${value ? OFF : ON}`}>
        Todas
      </button>
      {days.map((day) => (
        <button
          key={day.value}
          type="button"
          onClick={() => onChange(day.value)}
          className={`${BASE} ${value === day.value ? ON : OFF}`}
        >
          {day.label}
          <span className="ml-1 text-[10px] opacity-70">{day.date}</span>
        </button>
      ))}
    </div>
  );
}