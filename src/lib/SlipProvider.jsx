import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

const SlipContext = createContext(null);

export function SlipProvider({ children }) {
  const [selections, setSelections] = useState([]);

  const addSelection = useCallback((selection) => {
    setSelections((current) => {
      const withoutMarket = current.filter((item) => item.market_id !== selection.market_id);
      const already = current.some((item) => item.odd_id === selection.odd_id);
      return already ? withoutMarket : [...withoutMarket, selection];
    });
  }, []);

  const removeSelection = useCallback((oddId) => {
    setSelections((current) => current.filter((item) => item.odd_id !== oddId));
  }, []);

  const clear = useCallback(() => setSelections([]), []);

  const value = useMemo(() => {
    const totalOdd = selections.reduce((acc, item) => acc * Number(item.odd_value || 1), 1);
    return {
      selections,
      count: selections.length,
      totalOdd,
      addSelection,
      removeSelection,
      clear,
    };
  }, [selections, addSelection, removeSelection, clear]);

  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

export function useSlip() {
  const context = useContext(SlipContext);
  if (!context) throw new Error("useSlip precisa estar dentro de SlipProvider");
  return context;
}