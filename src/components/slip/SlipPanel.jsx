import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Info, Loader2, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import { useSlip } from "@/lib/SlipProvider";
import { useAuth } from "@/lib/AuthContext";
import { formatOdds } from "@/lib/format";

export default function SlipPanel({ onDone }) {
  const { selections, totalOdd, removeSelection, clear } = useSlip();
  const { isAuthenticated, navigateToLogin } = useAuth();
  const navigate = useNavigate();
  const [points, setPoints] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const potential = useMemo(() => Number(points || 0) * totalOdd, [points, totalOdd]);

  const confirm = async () => {
    setError("");
    if (!isAuthenticated) {
      navigateToLogin();
      return;
    }
    const stake = Math.floor(Number(points));
    if (!Number.isFinite(stake) || stake < 1 || stake > 10000) {
      setError("Informe uma quantidade de pontos entre 1 e 10.000.");
      return;
    }
    setSubmitting(true);
    try {
      // A validação (cotação aberta, partida publicada e fora da janela de 10
      // minutos) acontece no servidor, para que nenhuma aposta entre atrasada.
      const response = await base44.functions.invoke("placeWager", {
        stake,
        odd_ids: selections.map((item) => item.odd_id),
      });
      const data = response?.data || {};
      if (data.error) {
        if (data.blocked?.length) data.blocked.forEach((oddId) => removeSelection(oddId));
        setError(data.error);
        return;
      }

      await base44.functions.invoke("registerWager", { stake }).catch(() => null);

      clear();
      toast({ title: "Simulação registrada" });
      onDone?.();
      navigate("/minhas-simulacoes");
    } catch (err) {
      const data = err?.response?.data;
      if (data?.blocked?.length) {
        data.blocked.forEach((oddId) => removeSelection(oddId));
        toast({
          title: "Algumas seleções foram removidas",
          description: data.error,
        });
        return;
      }
      setError(data?.error || err.message || "Não foi possível registrar a simulação.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!selections.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
        <p className="font-medium">Seu boletim está vazio</p>
        <p className="text-sm text-muted-foreground">
          Toque nas odds de uma partida para montar um boletim de simulação.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto px-1 py-1">
        {selections.map((item) => (
          <div key={item.odd_id} className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.event_label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.market_name} · {item.odd_label}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="score-num text-sm font-semibold text-primary">{formatOdds(item.odd_value)}</span>
                <button
                  type="button"
                  onClick={() => removeSelection(item.odd_id)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={`Remover ${item.odd_label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-3 border-t border-border pt-3">
        <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <span className="text-muted-foreground">Odd combinada</span>
          <span className="score-num text-right font-semibold text-primary">{formatOdds(totalOdd)}</span>
          <Label htmlFor="slip-points" className="self-center text-muted-foreground">Aposta (pts)</Label>
          <Input
            id="slip-points"
            type="number"
            min={1}
            max={10000}
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            className="h-8 text-right"
          />
          <span className="text-muted-foreground">Retorno potencial</span>
          <span className="score-num text-right font-semibold">{potential.toFixed(2)} pts</span>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          As odds e o horário ficam registrados no momento da confirmação e não podem ser alterados depois.
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={clear} disabled={submitting}>
            Limpar
          </Button>
          <Button className="flex-[2]" onClick={confirm} disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isAuthenticated ? "Confirmar simulação" : "Entrar para simular"}
          </Button>
        </div>
      </div>
    </div>
  );
}