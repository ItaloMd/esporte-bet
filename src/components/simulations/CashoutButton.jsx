import React, { useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { formatCurrency } from "@/lib/format";
import { useWallet } from "@/lib/WalletProvider";

export default function CashoutButton({ ticket, available, onDone }) {
  const { setBalance } = useWallet();
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke("cashoutWager", { ticket_id: ticket.id });
      const data = response?.data || {};
      if (data.error) {
        toast({ title: "Cashout não realizado", description: data.error });
        return;
      }
      if (typeof data.balance === "number") setBalance(data.balance);
      toast({
        title: "Cashout realizado",
        description: `${formatCurrency(data.amount)} voltaram para o seu saldo.`,
      });
      onDone?.();
    } catch (err) {
      const data = err?.response?.data;
      toast({
        title: "Cashout não realizado",
        description: data?.error || err.message || "Não foi possível concluir o cashout.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={!available || loading} onClick={run}>
        {loading ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Undo2 className="mr-1.5 h-3.5 w-3.5" />
        )}
        Cashout {formatCurrency(ticket.stake_points)}
      </Button>
      <span className="text-[10px] text-muted-foreground">
        {available
          ? "Disponível até 10 minutos antes do início da partida."
          : "Cashout encerrado para este boletim."}
      </span>
    </div>
  );
}