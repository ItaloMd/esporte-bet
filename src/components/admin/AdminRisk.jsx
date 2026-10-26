import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import RiskOverview from "@/components/admin/risk/RiskOverview";
import RiskHistory from "@/components/admin/risk/RiskHistory";

const REFRESH_MS = 60000;

export default function AdminRisk() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const timer = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("adminRiskAnalysis", {});
      setData(response.data);
      setError("");
    } catch (err) {
      setError(err?.response?.data?.error || err.message || "Falha ao carregar a análise de caixa.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Atualização automática a cada 60 segundos · snapshot diário gravado no histórico
        </p>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Atualizar
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {data ? (
        <>
          <RiskOverview data={data} />
          <RiskHistory history={data.history || []} />
        </>
      ) : (
        !error && <div className="card-surface h-40 animate-pulse" />
      )}
    </div>
  );
}